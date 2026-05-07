import { callMcpToolJson } from "./mcp-session";

export type CreateDraftResult = {
  draft_id: string;
  message_id: string;
  status: string;
};

export type GetDraftResult = {
  draft_id: string;
  subject: string;
  to: string;
  from: string;
  body: string;
  status: string;
};

export type SendDraftResult = {
  message_id: string;
  thread_id: string;
  status: string;
};

function advisorEmail(): string {
  const email = process.env.GOOGLE_ADVISOR_EMAIL?.trim();
  if (!email) {
    throw new Error("GOOGLE_ADVISOR_EMAIL is not set");
  }
  return email;
}

export async function createAdvisorEmailDraft(params: {
  to?: string;
  subject: string;
  body: string;
  sender?: string;
}): Promise<CreateDraftResult> {
  const sender = params.sender ?? advisorEmail();
  const to = params.to ?? advisorEmail();
  return callMcpToolJson<CreateDraftResult>("create_email_draft", {
    to,
    subject: params.subject,
    body: params.body,
    sender
  });
}

export async function getEmailDraft(draftId: string): Promise<GetDraftResult> {
  return callMcpToolJson<GetDraftResult>("get_email_draft", {
    draft_id: draftId
  });
}

export async function sendEmailDraft(draftId: string): Promise<SendDraftResult> {
  return callMcpToolJson<SendDraftResult>("send_email_draft", {
    draft_id: draftId
  });
}
