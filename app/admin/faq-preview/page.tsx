import { SmartSyncFaqClient } from "@/ui/SmartSyncFaqClient";

export default function FaqPreviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-[clamp(1.8rem,4vw,2.8rem)] font-[520] tracking-[-0.03em] leading-tight"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: "var(--ink-soft)" }}
        >
          FAQ Preview
        </h1>
        <p className="mt-1 text-muted text-sm">
          Admin preview of the Smart-Sync Knowledge Base
        </p>
      </div>
      <SmartSyncFaqClient role="Admin" />
    </div>
  );
}
