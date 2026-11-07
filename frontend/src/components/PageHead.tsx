export function PageHead({ title, lead }: { title: string; lead: string }) {
  return (
    <header className="page-head">
      <h1>{title}</h1>
      <p>{lead}</p>
    </header>
  );
}

export function Loading({ loading }: { loading: boolean }) {
  return <div className="card empty">{loading ? 'Reading the vault from NEAR…' : 'Vault unavailable'}</div>;
}
