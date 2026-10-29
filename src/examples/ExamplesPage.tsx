import { useState } from "react";
import {
  ApplicationHomeFrame,
  ApplicationSidebar,
  Button,
  AetherIcon,
  TextField,
} from "@aether/ui";
import { isStudioExampleHosted as isStudioHosted } from "./runtime";
import { cadExamples, exampleAsset, type CADExample } from "./catalog";
import { saveExample } from "./save-example";
import "./examples.css";
import { cadCommands } from "../cad-command-registry";

export function ExamplesPage() {
  const [search, setSearch] = useState(""),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState("");
  const hosted = isStudioHosted();
  const save = async (example: CADExample) => {
    if (busy) return;
    setBusy(example.id);
    setError("");
    try {
      const url = await saveExample(example);
      if (url) location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const shown = cadExamples.filter((example) =>
    `${example.name} ${example.tags.join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <ApplicationHomeFrame
      layout="sidebar"
      design="studio"
      className="cad-examples"
    >
      <ApplicationSidebar
        id="cad-library"
        variant="captioned"
        name="Aether CAD"
        app="cad"
        sections={[
          {
            id: "library",
            title: "Library",
            items: [
              { id: "home", label: "Home", icon: "home", href: "./" },
              {
                id: "examples",
                label: "Examples",
                icon: "file-project",
                current: true,
              },
            ],
          },
        ]}
      />
      <main className="cad-examples-main">
        <header>
          <div>
            <span className="cad-examples-eyebrow">AETHER CAD</span>
            <h1>Examples</h1>
            <p>
              Explore real sketches, features and assemblies. Save a copy to
              make it yours.
            </p>
          </div>
          <TextField
            aria-label="Search examples"
            placeholder="Search examples or features…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </header>
        {error && (
          <p role="alert" className="cad-examples-error">
            {error}
          </p>
        )}
        <div className="cad-examples-grid">
          {shown.map((example) => (
            <article key={example.id}>
              <a
                className="cad-example-image"
                href={`./index.html?editor=1&example=${encodeURIComponent(example.id)}`}
                aria-label={`Open ${example.name}`}
              >
                <img
                  src={exampleAsset(example.thumbnail)}
                  alt={example.name}
                  loading="lazy"
                />
              </a>
              <div className="cad-example-content">
                <h2>{example.name}</h2>
                <p>{example.description}</p>
                <small>
                  {example.parts} parts · {example.instances} components ·{" "}
                  {example.features} sketches and features
                </small>
                <div className="cad-example-tags">
                  {example.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                {example.configurations &&
                  example.configurations.length > 1 && (
                    <nav
                      className="cad-example-configurations"
                      aria-label={`${example.name} assemblies`}
                    >
                      {example.configurations.map((configuration) => (
                        <a
                          key={configuration.id}
                          href={`./index.html?editor=1&example=${encodeURIComponent(example.id)}&assembly=${encodeURIComponent(configuration.id)}`}
                        >
                          {configuration.name}
                        </a>
                      ))}
                    </nav>
                  )}
                {example.sources && (
                  <small className="cad-example-sources">
                    {example.sources.map((source) => (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {source.title}
                      </a>
                    ))}
                  </small>
                )}
                {example.motion && (
                  <p className="cad-example-motion">{example.motion}</p>
                )}
                {example.reference && (
                  <small>
                    <a
                      href={example.reference.source}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Reference recipe
                    </a>{" "}
                    ·{" "}
                    <a
                      href={exampleAsset(example.reference.comparison)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Geometry comparison
                    </a>
                  </small>
                )}
                <footer>
                  <Button
                    onClick={() =>
                      location.assign(
                        `./index.html?editor=1&example=${encodeURIComponent(example.id)}`,
                      )
                    }
                  >
                    Open example
                  </Button>
                  <Button
                    primary
                    disabled={!!busy}
                    onClick={() => void save(example)}
                  >
                    {busy === example.id
                      ? "Saving…"
                      : hosted
                        ? "Save to My files"
                        : "Download .acad"}
                  </Button>
                </footer>
              </div>
            </article>
          ))}
        </div>
        {!shown.length && <p>No examples match this search.</p>}
        <p>
          <a
            href={exampleAsset("COMPARISON.md")}
            target="_blank"
            rel="noreferrer"
          >
            Read the SolidCraft comparison and current limitations
          </a>
        </p>
      </main>
    </ApplicationHomeFrame>
  );
}

export function ExampleBanner() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const example = cadExamples.find(
    (item) => item.id === new URLSearchParams(location.search).get("example"),
  );
  if (!example)
    return (
      <aside className="cad-example-banner" role="alert">
        This example is not available.{" "}
        <a href="./?examples=1">Browse examples</a>
      </aside>
    );
  return (
    <aside className="cad-example-banner" aria-label="Example file">
      <AetherIcon name="file-project" />
      <span>
        <strong>{example.name}</strong> · Example preview
      </span>
      {example.configurations && example.configurations.length > 1 && (
        <select
          aria-label="Example assembly"
          value={
            new URLSearchParams(location.search).get("assembly") ??
            example.assemblyId
          }
          onChange={(event) =>
            location.assign(
              `./index.html?editor=1&example=${encodeURIComponent(example.id)}&assembly=${encodeURIComponent(event.target.value)}`,
            )
          }
        >
          {example.configurations.map((configuration) => (
            <option key={configuration.id} value={configuration.id}>
              {configuration.name}
            </option>
          ))}
        </select>
      )}
      {example.motion &&
        (!example.configurations ||
          example.configurations.find(
            (c) =>
              c.id ===
              (new URLSearchParams(location.search).get("assembly") ??
                example.assemblyId),
          )?.movable) && (
          <Button onClick={() => cadCommands.execute("assembly-motion-study")}>
            Motion study
          </Button>
        )}
      <Button onClick={() => location.assign("./?examples=1")}>
        All examples
      </Button>
      <Button
        primary
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const url = await saveExample(
              example,
              new URLSearchParams(location.search).get("assembly") ??
                example.assemblyId,
            );
            if (url) location.assign(url);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Saving…"
          : isStudioHosted()
            ? "Save to My files"
            : "Download .acad"}
      </Button>
      {error && <span role="alert">{error}</span>}
    </aside>
  );
}
