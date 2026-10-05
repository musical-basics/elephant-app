import { useRef, useState } from "react";
import { ChevronRight, Folder, Search, X } from "lucide-react";
import type { Project } from "../lib/model";
import "./ProjectSearch.css";

const statusLabels = {
  active: "Active",
  inactive: "Upcoming",
  completed: "Completed",
};

export default function ProjectSearch({
  projects,
  onOpen,
}: {
  projects: Project[];
  onOpen: (projectId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const query = search.trim().toLocaleLowerCase();
  const results = query
    ? projects
        .filter((project) => project.name.toLocaleLowerCase().includes(query))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return (
    <section
      className="project-search"
      role="search"
      aria-label="Find a project"
    >
      <div className="project-search-field">
        <Search size={19} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          aria-label="Search projects"
          placeholder="Search projects…"
          autoComplete="off"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {search && (
          <button
            type="button"
            className="icon-button"
            aria-label="Clear project search"
            onClick={() => {
              setSearch("");
              inputRef.current?.focus();
            }}
          >
            <X size={18} />
          </button>
        )}
      </div>
      <p className="project-search-summary" role="status">
        {query
          ? results.length
            ? `${results.length} ${results.length === 1 ? "project" : "projects"} found`
            : "No projects found. Try a different name."
          : ""}
      </p>
      {results.length > 0 && (
        <ul className="project-search-results" aria-label="Matching projects">
          {results.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className="project-search-result"
                onClick={() => onOpen(project.id)}
              >
                <Folder size={20} aria-hidden="true" />
                <span>
                  <strong>{project.name}</strong>
                  <small>{statusLabels[project.status]}</small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
