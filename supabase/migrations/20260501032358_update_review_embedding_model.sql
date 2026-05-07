begin;

alter table public.review_embeddings
  drop constraint if exists review_embeddings_model_check;

alter table public.review_embeddings
  alter column model set default 'gemini-embedding-001';

alter table public.review_embeddings
  add constraint review_embeddings_model_check
  check (model = 'gemini-embedding-001');

commit;
