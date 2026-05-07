import { SecureDetailsClient } from "@/ui/SecureDetailsClient";

export default function SecureDetailsPage({ params }: { params: { token: string } }) {
  return <SecureDetailsClient token={params.token} />;
}
