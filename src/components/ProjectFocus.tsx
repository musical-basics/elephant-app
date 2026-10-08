import { useId, useState } from "react";
import { ArrowRight, Target } from "lucide-react";
import Sheet from "./Sheet";
import { activeFocusMode, currentQueueEntry } from "../lib/model";
import type { AppState } from "../lib/model";
import "./ProjectFocus.css";

type Props = {
  state: AppState;
  projectId?: string;
  onChange: (projectId: string | null, between: number) => void;
};
export default function ProjectFocus({ state, projectId, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const focus = activeFocusMode(state);
  const project = state.projects.find(
    (project) => project.id === focus?.projectId,
  );
  const eligible = state.projects.filter(
    (project) =>
      project.status === "active" &&
      state.items.some(
        (item) =>
          item.projectId === project.id &&
          !item.completedAt &&
          !item.isPlaceholder,
      ),
  );
  const current = currentQueueEntry(state);
  const focusedTurn = current?.item.projectId === focus?.projectId;
  if (projectId && !eligible.some((project) => project.id === projectId))
    return null;
  return (
    <>
      {projectId ? (
        <button
          className="secondary-button project-focus-launch"
          onClick={() => setOpen(true)}
        >
          <Target size={17} />
          {focus?.projectId === projectId
            ? "Focus settings"
            : "Focus on this project"}
        </button>
      ) : focus && project ? (
        <section
          className="project-focus-panel"
          aria-label="Focus mode"
          data-focus-turn={focusedTurn ? "project" : "master"}
        >
          <div className="project-focus-summary">
            <Target size={19} />
            <div>
              <p className="eyebrow">FOCUS MODE · {focus.between} BETWEEN</p>
              <strong>{project.name}</strong>
              <p className="small muted" aria-live="polite">
                {focusedTurn
                  ? "Your focus project’s turn."
                  : `${focus.remaining} master-list ${focus.remaining === 1 ? "item" : "items"} before returning.`}
              </p>
            </div>
          </div>
          <div className="project-focus-actions">
            <button className="text-button" onClick={() => setOpen(true)}>
              Change focus
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                try {
                  onChange(null, 0);
                  setError("");
                } catch (failure) {
                  setError((failure as Error).message);
                }
              }}
            >
              Stop focus mode
            </button>
          </div>
        </section>
      ) : (
        <div className="project-focus-invite">
          <button className="secondary-button" onClick={() => setOpen(true)}>
            <Target size={17} />
            Focus mode
          </button>
          <p className="small muted">
            Choose one project and how often to return to it.
          </p>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {open && (
        <FocusSetup
          state={state}
          initialProjectId={
            projectId ?? focus?.projectId ?? current?.project?.id
          }
          onClose={() => setOpen(false)}
          onChange={(id, between) => {
            onChange(id, between);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function FocusSetup({
  state,
  initialProjectId,
  onClose,
  onChange,
}: Props & { initialProjectId?: string; onClose: () => void }) {
  const projects = state.projects.filter(
    (project) =>
      project.status === "active" &&
      state.items.some(
        (item) =>
          item.projectId === project.id &&
          !item.completedAt &&
          !item.isPlaceholder,
      ),
  );
  const [projectId, setProjectId] = useState(
    projects.find((project) => project.id === initialProjectId)?.id ??
      projects[0]?.id ??
      "",
  );
  const [between, setBetween] = useState(state.focusMode?.between ?? 0);
  const [error, setError] = useState("");
  const spacingId = useId();
  return (
    <Sheet
      title="Focus mode"
      description="Choose a project, then decide how many other items come between its tasks."
      onClose={onClose}
    >
      <form
        className="sheet-form"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            onChange(projectId, between);
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Could not start focus mode.",
            );
          }
        }}
      >
        {projects.length ? (
          <>
            <label>
              Focus project
              <select
                aria-label="Focus project"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                required
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="focus-spacing">
              <legend>Master-list items between project tasks</legend>
              <div className="focus-spacing-options">
                {([0, 1, 2, 3] as const).map((value) => (
                  <label
                    key={value}
                    className={between === value ? "is-selected" : ""}
                  >
                    <input
                      type="radio"
                      aria-label={
                        value === 0
                          ? "0 consecutive project tasks"
                          : `${value} master-list ${value === 1 ? "item" : "items"} between project tasks`
                      }
                      name={spacingId}
                      value={value}
                      checked={between === value}
                      onChange={() => setBetween(value)}
                    />
                    <strong>{value}</strong>
                    <span>{value === 0 ? "In a row" : "Between"}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="focus-pattern" aria-label="Focus mode sequence">
              <span>Project item</span>
              {Array.from({ length: between }, (_, index) => (
                <span className="focus-pattern-other" key={index}>
                  <ArrowRight size={13} />
                  Master {index + 1}
                </span>
              ))}
              <ArrowRight size={13} />
              <span>Project item</span>
            </div>
            <p className="small muted">
              {between === 0
                ? "Work through this project consecutively."
                : `After each project task, complete ${between} ${between === 1 ? "item" : "items"} from the master list, skipping this project. Then return to your next project task.`}{" "}
              Focus starts with the chosen project. When its tasks are finished,
              the normal queue resumes.
            </p>
          </>
        ) : (
          <p className="small muted">
            Add a task to an active project first. Then you can focus on it
            here.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="sheet-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={!projects.length}
          >
            <Target size={17} />
            {activeFocusMode(state) ? "Save focus mode" : "Start focus mode"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
