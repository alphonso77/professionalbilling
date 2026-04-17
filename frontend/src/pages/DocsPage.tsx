import { NavLink, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useDocsContext } from "@/providers/DocsRegistryProvider";
import { cn } from "@/lib/utils";

export function DocsPage() {
  const { slug } = useParams<{ slug?: string }>();
  const { registry, isLoading, findEntryBySlug } = useDocsContext();

  if (isLoading) {
    return <p className="text-sm text-[var(--color-muted-foreground)]">Loading docs…</p>;
  }

  if (!registry) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">
        Docs unavailable.
      </p>
    );
  }

  const selected = slug ? findEntryBySlug(slug) : undefined;
  const firstEntry = registry.categories.flatMap((c) => c.entries)[0];
  const shown = selected ?? firstEntry;

  return (
    <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
      <aside className="md:sticky md:top-0 md:self-start">
        <nav className="space-y-4">
          {registry.categories.map((cat) => (
            <div key={cat.key}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                {cat.title}
              </h3>
              {cat.entries.length === 0 ? (
                <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                  (coming soon)
                </p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {cat.entries.map((e) => (
                    <li key={e.key}>
                      <NavLink
                        to={`/docs/${e.docSlug}`}
                        className={({ isActive }) =>
                          cn(
                            "block rounded-md px-2 py-1 text-sm transition-colors",
                            isActive
                              ? "bg-[var(--color-accent)] text-[var(--color-accent-foreground)] font-medium"
                              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
                          )
                        }
                      >
                        {e.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </nav>
      </aside>
      <article className="min-w-0">
        {shown ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">{shown.label}</h1>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
              {shown.tooltip}
            </p>
            <div className="prose prose-sm mt-6 max-w-none text-[var(--color-foreground)]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {shown.detail}
              </ReactMarkdown>
            </div>
            {shown.whatWeMeasure ? (
              <section className="mt-8">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  What we measure
                </h2>
                <p className="mt-2">{shown.whatWeMeasure}</p>
              </section>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Select an entry from the sidebar.
          </p>
        )}
      </article>
    </div>
  );
}
