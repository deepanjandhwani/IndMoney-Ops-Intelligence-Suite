type ModulePlaceholderProps = {
  title: string;
  role: "Customer" | "Admin";
  description: string;
};

export function ModulePlaceholder({
  title,
  role,
  description
}: ModulePlaceholderProps) {
  return (
    <section className="placeholder">
      <span>{role} Module</span>
      <h1>{title}</h1>
      <p>{description}</p>
      <p className="muted">Feature implementation starts in later phases.</p>
    </section>
  );
}
