#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import hdbscan
import numpy as np
import requests
import umap
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.metrics.pairwise import cosine_distances
from supabase import Client, create_client


PREDEFINED_THEMES = [
    "Nominee Updates",
    "Login Issues",
    "Statement Downloads",
    "SIP / Mandate Issues",
    "Withdrawal Delays",
    "Fee / Charge Confusion",
    "Account Changes",
    "App Performance",
    "KYC Issues",
    "Customer Support",
]

MIN_CLUSTER_SIZE = 5
RETRY_MIN_CLUSTER_SIZE = 3
MAX_THEMES = 5
TOP_ACTION_THEMES = 3
REPRESENTATIVE_QUOTES_COUNT = 3
# Closest-to-centroid quotes must carry enough signal (chars / words); relax by tier only if needed.
QUOTE_SUBSTANCE_TIERS: tuple[tuple[int, int], ...] = (
    (28, 5),
    (22, 4),
    (18, 3),
)
SUMMARY_MAX_WORDS = 250
ACTION_IDEAS_COUNT = 3
EMBEDDING_OUTPUT_DIMENSIONS = 768
MAX_REVIEW_PULSE_ROWS_RETAINED = 26
INGESTION_RUN_RETENTION_DAYS = 90
SUPABASE_IN_FILTER_BATCH_SIZE = 100

REPO_ROOT = Path(__file__).resolve().parent.parent
PULSE_ARTIFACT_PATH = REPO_ROOT / "artifacts" / "review-pulse-latest.json"

PII_PATTERNS = [
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b"),
    re.compile(r"\b[2-9][0-9]{3}[\s-]?[0-9]{4}[\s-]?[0-9]{4}\b"),
    re.compile(r"\b(?:\+?91[\s-]?)?[6-9][0-9][0-9\s-]{7,12}[0-9]\b"),
    re.compile(
        r"\b((?:otp|one[-\s]?time password|verification code)\s*(?:is|:|-)?\s*)[0-9]{4,8}\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b((?:account|acct|a/c|bank account|folio)\s*(?:number|no\.?|#)?\s*(?:is|:|-)?\s*)[0-9]{9,18}\b",
        re.IGNORECASE,
    ),
]


@dataclass
class ReviewRow:
    id: str
    review_text: str
    rating: int
    review_date: str


@dataclass
class ThemeCandidate:
    cluster_id: int
    label: str
    theme_type: str
    review_count: int
    keywords: list[str]
    member_indices: list[int]


class GeminiClient:
    def __init__(self, api_key: str, generation_model: str, embedding_model: str):
        self.api_key = api_key
        self.generation_model = generation_model
        self.embedding_model = embedding_model

    def batch_embed(self, texts: list[str]) -> list[list[float]]:
        return [self.embed(text) for text in texts]

    def embed(self, text: str) -> list[float]:
        model_path = self._model_path(self.embedding_model)
        url = (
            "https://generativelanguage.googleapis.com/v1beta/"
            f"{model_path}:embedContent"
        )
        body = {
            "model": model_path,
            "content": {"parts": [{"text": text}]},
            "outputDimensionality": EMBEDDING_OUTPUT_DIMENSIONS,
        }
        data = self._post_json(url, body)
        return data["embedding"]["values"]

    def generate_json(self, prompt: str) -> dict[str, Any]:
        model_path = self._model_path(self.generation_model)
        url = (
            "https://generativelanguage.googleapis.com/v1beta/"
            f"{model_path}:generateContent"
        )
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json"},
        }
        data = self._post_json(url, body)
        text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "{}")
        )
        return parse_json_text(text)

    def _post_json(self, url: str, body: dict[str, Any]) -> dict[str, Any]:
        for attempt in range(4):
            response = requests.post(
                url,
                params={"key": self.api_key},
                json=body,
                timeout=45,
            )
            if response.ok:
                return response.json()
            if attempt < 3 and response.status_code in {429, 500, 502, 503, 504}:
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError(f"Gemini API failed: {response.status_code} {response.text}")
        raise RuntimeError("Gemini API failed after retry")

    @staticmethod
    def _model_path(model: str) -> str:
        return model if model.startswith("models/") else f"models/{model}"


def main() -> int:
    supabase = create_supabase_client()
    gemini = GeminiClient(
        api_key=required_env("GEMINI_API_KEY"),
        generation_model=os.getenv("GEMINI_GENERATION_MODEL", "gemini-2.5-flash"),
        embedding_model=os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001"),
    )
    window_weeks = int(os.getenv("REVIEW_INGESTION_WINDOW_WEEKS", "12"))
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(weeks=window_weeks)
    reviews = fetch_reviews(supabase, window_start)

    if len(reviews) < MIN_CLUSTER_SIZE:
        return preserve_previous_pulse(
            f"Only {len(reviews)} reviews in rolling window; clustering skipped."
        )

    reviews = verify_masked_reviews(supabase, reviews)
    embeddings = load_or_create_embeddings(supabase, gemini, reviews)
    labels = cluster_embeddings(embeddings, MIN_CLUSTER_SIZE)

    if count_clusters(labels) == 0:
        labels = cluster_embeddings(embeddings, RETRY_MIN_CLUSTER_SIZE)

    if count_clusters(labels) == 0:
        return preserve_previous_pulse("All reviews assigned to noise; previous pulse preserved.")

    keywords_by_cluster = compute_ctfidf_keywords(reviews, labels)
    themes = build_theme_candidates(reviews, embeddings, labels, keywords_by_cluster)

    if len(themes) < MAX_THEMES:
        return preserve_previous_pulse(
            f"Only {len(themes)} usable themes found; previous pulse preserved."
        )

    themes = themes[:MAX_THEMES]
    refine_labels(gemini, themes)
    representative_quotes = select_representative_quotes(
        reviews, embeddings, themes[:TOP_ACTION_THEMES]
    )
    action_ideas = generate_action_ideas(
        gemini, themes[:TOP_ACTION_THEMES], representative_quotes
    )
    weekly_summary = generate_summary(gemini, themes, reviews, window_start, now)
    pulse_id = store_review_pulse(
        supabase=supabase,
        themes=themes,
        representative_quotes=representative_quotes,
        action_ideas=action_ideas,
        weekly_summary=weekly_summary,
        reviews=reviews,
        window_start=window_start,
        window_end=now,
    )
    store_theme_snapshots(supabase, pulse_id, themes, len(reviews), now)
    export_latest_pulse_json(supabase, pulse_id)
    apply_retention_policy(supabase)
    print(
        json.dumps(
            {
                "status": "success",
                "pulse_id": pulse_id,
                "themes": len(themes),
                "pulse_export_path": str(PULSE_ARTIFACT_PATH),
            }
        )
    )
    return 0


def create_supabase_client() -> Client:
    supabase_url = (
        os.getenv("SUPABASE_URL")
        or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
        or os.getenv("GH_SUPABASE_URL")
    )
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv(
        "GH_SUPABASE_SERVICE_ROLE_KEY"
    )
    if not supabase_url:
        raise RuntimeError("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL")
    if not service_key:
        raise RuntimeError("Missing SUPABASE_SERVICE_ROLE_KEY")
    return create_client(supabase_url, service_key)


def fetch_reviews(supabase: Client, window_start: datetime) -> list[ReviewRow]:
    response = (
        supabase.table("reviews")
        .select("id,review_text,rating,review_date")
        .gte("review_date", window_start.isoformat())
        .order("review_date", desc=True)
        .execute()
    )
    return [
        ReviewRow(
            id=row["id"],
            review_text=row["review_text"],
            rating=int(row["rating"]),
            review_date=row["review_date"],
        )
        for row in response.data
    ]


def verify_masked_reviews(supabase: Client, reviews: list[ReviewRow]) -> list[ReviewRow]:
    masked_reviews: list[ReviewRow] = []
    for review in reviews:
        masked_text = mask_pii(review.review_text)
        if masked_text != review.review_text:
            supabase.table("reviews").update({"review_text": masked_text}).eq(
                "id", review.id
            ).execute()
        masked_reviews.append(
            ReviewRow(
                id=review.id,
                review_text=masked_text,
                rating=review.rating,
                review_date=review.review_date,
            )
        )
    return masked_reviews


def load_or_create_embeddings(
    supabase: Client, gemini: GeminiClient, reviews: list[ReviewRow]
) -> np.ndarray:
    review_ids = [review.id for review in reviews]
    existing: dict[str, list[float]] = {}
    for review_id_batch in chunks(review_ids, SUPABASE_IN_FILTER_BATCH_SIZE):
        response = (
            supabase.table("review_embeddings")
            .select("review_id,embedding")
            .in_("review_id", review_id_batch)
            .execute()
        )
        existing.update({row["review_id"]: row["embedding"] for row in response.data})

    missing_reviews = [review for review in reviews if review.id not in existing]
    for chunk in chunks(missing_reviews, 100):
        new_embeddings = gemini.batch_embed([review.review_text for review in chunk])
        if len(new_embeddings) != len(chunk):
            raise RuntimeError("Embedding API returned a different count than requested.")
        rows = [
            {
                "review_id": review.id,
                "embedding": embedding,
                "model": os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001"),
            }
            for review, embedding in zip(chunk, new_embeddings)
        ]
        if rows:
            supabase.table("review_embeddings").insert(rows).execute()
            for review, embedding in zip(chunk, new_embeddings):
                existing[review.id] = embedding

    return np.array([existing[review.id] for review in reviews], dtype=float)


def cluster_embeddings(embeddings: np.ndarray, min_cluster_size: int) -> np.ndarray:
    n_neighbors = min(15, max(2, len(embeddings) - 1))
    reduced = umap.UMAP(
        n_components=5,
        n_neighbors=n_neighbors,
        min_dist=0.0,
        metric="cosine",
        random_state=42,
    ).fit_transform(embeddings)
    min_samples = min(3, max(1, min_cluster_size - 1))
    return hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="euclidean",
    ).fit_predict(reduced)


def compute_ctfidf_keywords(
    reviews: list[ReviewRow], labels: np.ndarray
) -> dict[int, list[str]]:
    cluster_ids = sorted({int(label) for label in labels if int(label) != -1})
    documents = [
        " ".join(
            review.review_text
            for review, label in zip(reviews, labels)
            if int(label) == cluster_id
        )
        for cluster_id in cluster_ids
    ]
    vectorizer = CountVectorizer(stop_words="english", ngram_range=(1, 2), max_features=1000)
    try:
        counts = vectorizer.fit_transform(documents).toarray().astype(float)
    except ValueError:
        return {cluster_id: fallback_keywords(doc) for cluster_id, doc in zip(cluster_ids, documents)}

    words = np.array(vectorizer.get_feature_names_out())
    words_per_cluster = np.maximum(counts.sum(axis=1, keepdims=True), 1)
    term_frequency = counts / words_per_cluster
    document_frequency = np.maximum((counts > 0).sum(axis=0), 1)
    inverse_document_frequency = np.log((1 + len(cluster_ids)) / document_frequency)
    ctfidf = term_frequency * inverse_document_frequency

    keywords: dict[int, list[str]] = {}
    for row_index, cluster_id in enumerate(cluster_ids):
        top_indices = np.argsort(ctfidf[row_index])[::-1][:5]
        keywords[cluster_id] = [word for word in words[top_indices].tolist() if word]
    return keywords


def build_theme_candidates(
    reviews: list[ReviewRow],
    embeddings: np.ndarray,
    labels: np.ndarray,
    keywords_by_cluster: dict[int, list[str]],
) -> list[ThemeCandidate]:
    themes: list[ThemeCandidate] = []
    for cluster_id, keywords in keywords_by_cluster.items():
        member_indices = [
            index for index, label in enumerate(labels) if int(label) == cluster_id
        ]
        if not member_indices:
            continue
        themes.append(
            ThemeCandidate(
                cluster_id=cluster_id,
                label=keyword_label(keywords),
                theme_type="emergent",
                review_count=len(member_indices),
                keywords=keywords,
                member_indices=member_indices,
            )
        )
    themes.sort(key=lambda theme: theme.review_count, reverse=True)
    return themes


def refine_labels(gemini: GeminiClient, themes: list[ThemeCandidate]) -> None:
    prompt = (
        "You are classifying customer review themes for the Groww app.\n"
        "Use a predefined theme exactly when keywords clearly match it. "
        "Otherwise create a concise emergent label of 2 to 4 words.\n\n"
        f"Predefined themes: {json.dumps(PREDEFINED_THEMES)}\n"
        f"Clusters: {json.dumps([theme_payload(theme) for theme in themes])}\n\n"
        'Return JSON: {"labels":[{"cluster_id":0,"label":"Login Issues",'
        '"is_predefined":true,"predefined_match":"Login Issues"}]}'
    )
    response = retry_json_call(gemini, prompt)
    labels = response.get("labels", [])
    labels_by_cluster = {int(item["cluster_id"]): item for item in labels if "cluster_id" in item}

    for theme in themes:
        item = labels_by_cluster.get(theme.cluster_id)
        if not item:
            continue
        predefined_match = item.get("predefined_match")
        if item.get("is_predefined") and predefined_match in PREDEFINED_THEMES:
            theme.label = predefined_match
            theme.theme_type = "predefined"
        else:
            theme.label = str(item.get("label") or theme.label)[:80]
            theme.theme_type = "emergent"


def select_representative_quotes(
    reviews: list[ReviewRow], embeddings: np.ndarray, themes: list[ThemeCandidate]
) -> list[str]:
    quotes: list[str] = []
    used_quotes: set[str] = set()
    used_theme_indices: set[int] = set()
    for min_chars, min_words in QUOTE_SUBSTANCE_TIERS:
        candidates = quote_candidates_for_tier(
            reviews, embeddings, themes, min_chars, min_words
        )
        for theme_index, _distance, excerpt in candidates:
            if len(quotes) >= REPRESENTATIVE_QUOTES_COUNT:
                break
            if theme_index in used_theme_indices or excerpt in used_quotes:
                continue
            quotes.append(excerpt)
            used_quotes.add(excerpt)
            used_theme_indices.add(theme_index)

        for _theme_index, _distance, excerpt in candidates:
            if len(quotes) >= REPRESENTATIVE_QUOTES_COUNT:
                break
            if excerpt in used_quotes:
                continue
            quotes.append(excerpt)
            used_quotes.add(excerpt)

        if len(quotes) >= REPRESENTATIVE_QUOTES_COUNT:
            break

    if len(quotes) != REPRESENTATIVE_QUOTES_COUNT:
        raise RuntimeError(
            f"Pulse did not produce {REPRESENTATIVE_QUOTES_COUNT} substantive quotes."
        )
    return quotes


def quote_candidates_for_tier(
    reviews: list[ReviewRow],
    embeddings: np.ndarray,
    themes: list[ThemeCandidate],
    min_chars: int,
    min_words: int,
) -> list[tuple[int, float, str]]:
    candidates: list[tuple[int, float, str]] = []
    for theme_index, theme in enumerate(themes):
        member_embeddings = embeddings[theme.member_indices]
        centroid = member_embeddings.mean(axis=0).reshape(1, -1)
        distances = cosine_distances(member_embeddings, centroid).reshape(-1)
        for position in np.argsort(distances):
            row_index = theme.member_indices[int(position)]
            raw_text = reviews[row_index].review_text
            if not meets_quote_substance(raw_text, min_chars, min_words):
                continue
            excerpt = truncate_quote(raw_text)
            candidates.append((theme_index, float(distances[int(position)]), excerpt))
    candidates.sort(key=lambda item: (item[0], item[1]))
    return candidates


def meets_quote_substance(text: str, min_chars: int, min_words: int) -> bool:
    compact = " ".join(text.split())
    if len(compact) < min_chars:
        return False
    return len(compact.split()) >= min_words


def generate_action_ideas(
    gemini: GeminiClient,
    themes: list[ThemeCandidate],
    representative_quotes: list[str],
) -> list[dict[str, str]]:
    themes_payload = [theme_for_prompt(theme, include_quotes=False) for theme in themes]
    prompt = (
        "You are drafting internal product action ideas for Groww using ONLY the "
        "top 3 themes below and the overall representative customer quotes.\n"
        "Rules:\n"
        "- Output exactly 3 action ideas.\n"
        "- Each idea maps to exactly one of the themes by exact theme label.\n"
        "- Each evidence field must summarize or quote from the representative quotes only.\n"
        "- Do not invent themes, issues, or quotes.\n\n"
        f"Top themes: {json.dumps(themes_payload)}\n"
        f"Representative quotes: {json.dumps(representative_quotes)}\n\n"
        'Return JSON: {"action_ideas":[{"idea":"...",'
        '"based_on_theme":"<exact theme label>","evidence":"..."}, ...]}'
    )
    response = retry_json_call(gemini, prompt)
    return normalize_structured_action_ideas(response.get("action_ideas"), themes)


def normalize_structured_action_ideas(
    raw: Any, themes: list[ThemeCandidate]
) -> list[dict[str, str]]:
    allowed_labels = [theme.label for theme in themes]
    allowed_set = set(allowed_labels)
    if not isinstance(raw, list):
        raise RuntimeError("Gemini action_ideas response must be a JSON array.")

    normalized: list[dict[str, str]] = []
    for item in raw:
        if isinstance(item, str):
            raise RuntimeError("Legacy string action ideas are not accepted.")
        if not isinstance(item, dict):
            continue
        idea = str(item.get("idea", "")).strip()
        based_on = str(item.get("based_on_theme", "")).strip()
        evidence = str(item.get("evidence", "")).strip()
        if not idea or not based_on or not evidence:
            continue
        if based_on not in allowed_set:
            raise RuntimeError(f'Action idea referenced unknown theme "{based_on}".')
        normalized.append(
            {"idea": idea, "based_on_theme": based_on, "evidence": evidence}
        )
        if len(normalized) == ACTION_IDEAS_COUNT:
            break

    if len(normalized) != ACTION_IDEAS_COUNT:
        raise RuntimeError(
            "Gemini action ideas response did not contain exactly 3 valid structured items."
        )

    used_labels = {entry["based_on_theme"] for entry in normalized}
    if len(used_labels) != ACTION_IDEAS_COUNT:
        raise RuntimeError("Each action idea must reference a distinct theme label.")

    return normalized


def generate_summary(
    gemini: GeminiClient,
    themes: list[ThemeCandidate],
    reviews: list[ReviewRow],
    window_start: datetime,
    window_end: datetime,
) -> str:
    prompt = (
        "Summarize this week's Google Play Store review trends for Groww in "
        "250 words or less for an internal product and ops audience.\n"
        f"Period: {period_label(window_start, window_end)}\n"
        f"Total reviews: {len(reviews)}\n"
        f"Average rating: {average_rating(reviews)}\n"
        f"Top themes: {json.dumps([theme_for_prompt(theme, include_quotes=False) for theme in themes])}\n"
        'Return JSON: {"summary":"..."}'
    )
    response = retry_json_call(gemini, prompt)
    summary = str(response.get("summary", "")).strip()
    if not summary:
        raise RuntimeError("Gemini summary response was empty.")
    return limit_words(summary, SUMMARY_MAX_WORDS)


def store_review_pulse(
    supabase: Client,
    themes: list[ThemeCandidate],
    representative_quotes: list[str],
    action_ideas: list[dict[str, str]],
    weekly_summary: str,
    reviews: list[ReviewRow],
    window_start: datetime,
    window_end: datetime,
) -> str:
    top_themes = [
        {"theme": theme.label, "rank": index + 1}
        for index, theme in enumerate(themes)
    ]
    response = (
        supabase.table("review_pulse")
        .insert(
            {
                "product": "Groww",
                "period": period_label(window_start, window_end),
                "total_reviews_analyzed": len(reviews),
                "average_rating": average_rating(reviews),
                "top_themes": top_themes,
                "representative_quotes": representative_quotes,
                "weekly_summary": weekly_summary,
                "action_ideas": action_ideas,
                "top_customer_themes": [theme.label for theme in themes[:TOP_ACTION_THEMES]],
                "source": "Google Play Store Reviews",
            }
        )
        .execute()
    )
    return response.data[0]["id"]


def store_theme_snapshots(
    supabase: Client,
    pulse_id: str,
    themes: list[ThemeCandidate],
    total_reviews: int,
    now: datetime,
) -> None:
    week_end = now.date()
    week_start = (now - timedelta(days=6)).date()
    previous_counts = fetch_previous_theme_counts(supabase, week_end.isoformat())
    rows = []
    for theme in themes:
        trend_status, wow_change_percent = trend_for(theme, previous_counts)
        rows.append(
            {
                "pulse_id": pulse_id,
                "theme_name": theme.label,
                "theme_type": theme.theme_type,
                "review_count": theme.review_count,
                "theme_share_percent": round(theme.review_count * 100 / total_reviews, 2),
                "keywords": theme.keywords,
                "trend_status": trend_status,
                "wow_change_percent": wow_change_percent,
                "week_start": week_start.isoformat(),
                "week_end": week_end.isoformat(),
            }
        )
    if rows:
        supabase.table("theme_snapshots").insert(rows).execute()


def fetch_previous_theme_counts(supabase: Client, before_week_end: str) -> dict[str, int]:
    response = (
        supabase.table("theme_snapshots")
        .select("theme_name,review_count,week_end")
        .lt("week_end", before_week_end)
        .order("week_end", desc=True)
        .limit(100)
        .execute()
    )
    counts: dict[str, int] = {}
    for row in response.data:
        counts.setdefault(row["theme_name"], int(row["review_count"]))
    return counts


def trend_for(theme: ThemeCandidate, previous_counts: dict[str, int]) -> tuple[str, float | None]:
    previous_count = previous_counts.get(theme.label)
    if not previous_count:
        return "emerging", None
    wow_change = round(((theme.review_count - previous_count) / previous_count) * 100, 2)
    if wow_change > 20:
        return "worsening", wow_change
    if wow_change < -20:
        return "improving", wow_change
    return "stable", wow_change


def retry_json_call(gemini: GeminiClient, prompt: str) -> dict[str, Any]:
    last_error: Exception | None = None
    for _ in range(2):
        try:
            return gemini.generate_json(prompt)
        except Exception as error:
            last_error = error
            time.sleep(1)
    raise RuntimeError(f"Gemini returned malformed JSON: {last_error}")


def parse_json_text(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    return json.loads(cleaned)


def count_clusters(labels: np.ndarray) -> int:
    return len({int(label) for label in labels if int(label) != -1})


def average_rating(reviews: list[ReviewRow]) -> float:
    return round(sum(review.rating for review in reviews) / len(reviews), 2)


def mask_pii(text: str) -> str:
    masked = text
    for pattern in PII_PATTERNS:
        masked = pattern.sub(lambda match: keep_prefix_if_present(match), masked)
    return masked


def keep_prefix_if_present(match: re.Match[str]) -> str:
    if match.lastindex:
        prefix = match.group(1) or ""
        return f"{prefix}[REDACTED]"
    return "[REDACTED]"


def chunks(items: list[Any], size: int) -> list[list[Any]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def fallback_keywords(document: str) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z0-9]+", document.lower())
    unique_words = []
    for word in words:
        if word not in unique_words:
            unique_words.append(word)
        if len(unique_words) == 5:
            break
    return unique_words


def keyword_label(keywords: list[str]) -> str:
    return " ".join(word.title() for word in keywords[:2]) or "Emergent Theme"


def truncate_quote(text: str, max_chars: int = 120) -> str:
    compact = " ".join(text.split())
    if len(compact) <= max_chars:
        return compact
    return f"{compact[: max_chars - 3].rstrip()}..."


def limit_words(text: str, max_words: int) -> str:
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words])


def period_label(window_start: datetime, window_end: datetime) -> str:
    return (
        f"Rolling 12 weeks ending {window_end.date().isoformat()} "
        f"(from {window_start.date().isoformat()})"
    )


def theme_payload(theme: ThemeCandidate) -> dict[str, Any]:
    return {
        "cluster_id": theme.cluster_id,
        "keywords": theme.keywords,
        "review_count": theme.review_count,
    }


def theme_for_prompt(theme: ThemeCandidate, include_quotes: bool = True) -> dict[str, Any]:
    _ = include_quotes
    return {
        "theme": theme.label,
        "review_count": theme.review_count,
        "keywords": theme.keywords,
    }


def preserve_previous_pulse(reason: str) -> int:
    print(json.dumps({"status": "partial_success", "preserved_previous_pulse": True, "reason": reason}))
    return 0


def export_latest_pulse_json(supabase: Client, pulse_id: str) -> None:
    response = (
        supabase.table("review_pulse").select("*").eq("id", pulse_id).limit(1).execute()
    )
    rows = response.data or []
    if not rows:
        raise RuntimeError(f"Cannot export pulse {pulse_id}: row missing.")
    record = rows[0]
    PULSE_ARTIFACT_PATH.parent.mkdir(parents=True, exist_ok=True)
    PULSE_ARTIFACT_PATH.write_text(json.dumps(record, indent=2, default=str), encoding="utf-8")


def apply_retention_policy(supabase: Client) -> None:
    """Trim historical pulses/snapshots and old ingestion metadata for Supabase free tier."""
    response = (
        supabase.table("review_pulse")
        .select("id")
        .order("created_at", desc=True)
        .execute()
    )
    rows = response.data or []
    if len(rows) > MAX_REVIEW_PULSE_ROWS_RETAINED:
        excess_ids = [row["id"] for row in rows[MAX_REVIEW_PULSE_ROWS_RETAINED :]]
        batch_size = 50
        for start in range(0, len(excess_ids), batch_size):
            chunk = excess_ids[start : start + batch_size]
            supabase.table("review_pulse").delete().in_("id", chunk).execute()

    cutoff = datetime.now(timezone.utc) - timedelta(days=INGESTION_RUN_RETENTION_DAYS)
    supabase.table("ingestion_runs").delete().lt("run_time", cutoff.isoformat()).execute()


def required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing {name}")
    return value


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}), file=sys.stderr)
        raise
