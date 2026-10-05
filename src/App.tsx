import { useEffect, useRef, useState } from "react";
import type {
  FormEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  Cloud,
  Copy,
  Download,
  Folder,
  GripVertical,
  Home,
  Layers,
  Leaf,
  List,
  LoaderCircle,
  LogOut,
  Moon,
  Plus,
  RotateCcw,
  Scissors,
  Search,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import DesignGallery from "./components/DesignGallery";
import { Botanical, Elephant } from "./components/Elephant";
import Sheet from "./components/Sheet";
import { designs } from "./lib/designs";
import type { DesignId } from "./lib/designs";
import {
  addItem,
  addProject,
  completeCurrent,
  createEmptyState,
  deleteItem,
  deleteProject,
  duplicateItem,
  exportCsv,
  moveItem,
  putBackItem,
  renameItem,
  reorderItem,
  resolveQueue,
  takeBite,
  updateProject,
  validateImport,
} from "./lib/model";
import type { AppState, Item, Project } from "./lib/model";
import { useWorkspace } from "./lib/useWorkspace";

type Screen =
  | "home"
  | "focus"
  | "projects"
  | "project"
  | "completed"
  | "settings"
  | "queue";
type Route = { design: DesignId | null; screen: Screen; projectId?: string };
type Modal =
  | { kind: "item"; projectId?: string; afterId?: string }
  | { kind: "project" }
  | { kind: "bite" }
  | { kind: "rename"; item: Item }
  | { kind: "delete"; item: Item }
  | { kind: "deleteProject"; project: Project }
  | { kind: "completeProject"; project: Project }
  | { kind: "reset" }
  | { kind: "import"; data: AppState };

function readRoute(): Route {
  const [hashDesign, screen, projectId] = window.location.hash
    .replace(/^#\/?/, "")
    .split("/");
  const design = window.location.hash.startsWith("#/")
    ? hashDesign
    : new URLSearchParams(window.location.search).get("design");
  let decodedProjectId: string | undefined;
  try {
    decodedProjectId = projectId ? decodeURIComponent(projectId) : undefined;
  } catch {
    decodedProjectId = undefined;
  }
  return {
    design: designs.some((d) => d.id === design) ? (design as DesignId) : null,
    screen: ([
      "home",
      "focus",
      "projects",
      "project",
      "completed",
      "settings",
      "queue",
    ].includes(screen)
      ? screen
      : "home") as Screen,
    projectId: decodedProjectId,
  };
}

function formatDate(value: string, includeTime = false) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(includeTime ? ({ hour: "numeric", minute: "2-digit" } as const) : {}),
  });
}

function downloadFile(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default function App() {
  const workspace = useWorkspace();
  const { state, update } = workspace;
  const [route, setRoute] = useState<Route>(readRoute);
  const [modal, setModal] = useState<Modal | null>(null);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");
  const [projectTab, setProjectTab] = useState<"active" | "inactive">("active");
  const [completedTab, setCompletedTab] = useState<"items" | "projects">(
    "items",
  );
  const [sort, setSort] = useState("name");
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const [emailStatus, setEmailStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [csvList, setCsvList] = useState<
    | "queue"
    | "completed"
    | "active"
    | "inactive"
    | "items"
    | "completedProjects"
  >("completed");
  const { design: designId, screen, projectId } = route;
  const design = designs.find((d) => d.id === designId) ?? designs[0];
  const queue = resolveQueue(state);
  const current = queue[0];
  const project = state.projects.find((p) => p.id === projectId);
  const remainingProjectItems = state.items.filter(
    (item) => item.projectId === project?.id && !item.completedAt,
  );
  const completedItems = state.items
    .filter((i) => i.completedAt)
    .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!));
  const completedToday = completedItems.filter(
    (i) =>
      new Date(i.completedAt!).toDateString() === new Date().toDateString(),
  ).length;
  const activeProjects = state.projects.filter((p) => p.status === "active");

  useEffect(() => {
    const handler = () => {
      setRoute(readRoute());
      setSelectedItem(null);
      setModal(null);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  useEffect(() => {
    document.title = designId
      ? `Elephant · ${design.name} · ${screen === "focus" ? "Do now" : screen.charAt(0).toUpperCase() + screen.slice(1)}`
      : "Elephant — Five fresh perspectives";
  }, [designId, design.name, screen]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    setFormError("");
  }, [modal]);

  function navigate(next: Screen, id?: string) {
    window.location.hash = `/${design.id}/${next}${id ? `/${encodeURIComponent(id)}` : ""}`;
  }
  function downloadBackup() {
    if (workspace.recoveryNeeded) return;
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      downloadFile(
        JSON.stringify(state, null, 2),
        `elephant-backup-${timestamp}.json`,
        "application/json",
      );
      setToast("JSON backup download started. Keep the file somewhere safe.");
    } catch {
      setToast("Could not start the backup download. Please try again.");
    }
  }
  function mutate(action: (s: AppState) => AppState, message?: string) {
    try {
      update(action(state));
      if (message) setToast(message);
    } catch (e) {
      setFormError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
    }
  }
  function submit(action: (s: AppState) => AppState, message: string) {
    try {
      update(action(state));
      setModal(null);
      setToast(message);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Please check the fields.");
    }
  }
  function duplicate(item: Item) {
    mutate((s) => duplicateItem(s, item.id), "Item duplicated.");
  }
  function submitForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields = new FormData(e.currentTarget);
    if (modal?.kind === "item")
      submit(
        (s) =>
          addItem(
            s,
            String(fields.get("title")),
            String(fields.get("projectId")) || undefined,
            modal.afterId,
          ),
        "A small step, added.",
      );
    if (modal?.kind === "project") {
      try {
        const next = addProject(state, String(fields.get("name")));
        const created = next.projects.find(
          (p) => !state.projects.some((old) => old.id === p.id),
        );
        update(next);
        setModal(null);
        if (created) navigate("project", created.id);
      } catch (e) {
        setFormError((e as Error).message);
      }
    }
    if (modal?.kind === "bite")
      submit(
        (s) =>
          takeBite(
            s,
            String(fields.get("first")),
            String(fields.get("remainder")),
          ),
        "A smaller step. You’ve got this.",
      );
    if (modal?.kind === "rename")
      submit(
        (s) => renameItem(s, modal.item.id, String(fields.get("title"))),
        "Item updated.",
      );
  }

  if (!designId)
    return (
      <DesignGallery
        onSelect={(id) => {
          window.location.hash = `/${id}/home`;
        }}
      />
    );

  const links: { screen: Screen; label: string; icon: ReactNode }[] = [
    { screen: "home", label: "Home", icon: <Home size={20} /> },
    { screen: "focus", label: "Do now", icon: <Circle size={20} /> },
    { screen: "projects", label: "Projects", icon: <Layers size={20} /> },
    {
      screen: "completed",
      label: "Completed",
      icon: <CircleCheck size={20} />,
    },
  ];
  const nav = (mobile = false) => (
    <nav
      aria-label={mobile ? "Mobile navigation" : "Main navigation"}
      className={mobile ? "bottom-nav" : "side-nav"}
    >
      {links.map((link) => (
        <button
          key={link.screen}
          onClick={() => navigate(link.screen)}
          aria-current={
            screen === link.screen ||
            (screen === "project" && link.screen === "projects")
              ? "page"
              : undefined
          }
        >
          {link.icon}
          <span>{link.label}</span>
        </button>
      ))}
    </nav>
  );

  return (
    <div className={`theme theme-${design.id}`}>
      <div className="design-toolbar">
        <a href="#/" className="back-designs">
          <ArrowLeft size={14} />
          <span>All designs</span>
        </a>
        <div className="design-picker">
          <span className="toolbar-caption">EXPLORING</span>
          <span className="design-dot" />
          <select
            aria-label="Select a design"
            value={design.id}
            onChange={(e) => {
              window.location.hash = `/${e.target.value}/${screen}${projectId ? `/${encodeURIComponent(projectId)}` : ""}`;
            }}
          >
            {designs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.number} / {d.name}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </div>
        <span className="toolbar-right">One app. Five perspectives.</span>
      </div>
      <div className="app-shell">
        <aside className="sidebar">
          <button className="wordmark" onClick={() => navigate("home")}>
            <Elephant />
            <span>
              elephant<span className="wordmark-dot">.</span>
            </span>
          </button>
          <p className="side-caption">ONE BITE AT A TIME</p>
          {nav()}
          <div className="sidebar-bottom">
            <div className="sidebar-note">
              <Leaf size={19} />
              <p>
                There’s only one thing
                <br />
                to do right now.
              </p>
            </div>
            <button
              className={`settings-link ${screen === "settings" ? "active" : ""}`}
              onClick={() => navigate("settings")}
            >
              <Settings size={19} />
              Settings
            </button>
            <div className="sidebar-profile">
              <Avatar profile={state.profile} />
              <div>
                <strong>{state.profile.name || "Your space"}</strong>
                <small>
                  {workspace.mode === "cloud"
                    ? "Your personal space"
                    : "Saved on this device"}
                </small>
              </div>
            </div>
          </div>
        </aside>
        <div className={`main-shell screen-${screen}`}>
          <header className="app-header">
            <button
              className="wordmark mobile-wordmark"
              onClick={() => navigate("home")}
            >
              <Elephant size={28} />
              <span>elephant.</span>
            </button>
            <div className="desktop-breadcrumb">
              <span>Your space</span>
              <ChevronRight size={13} />
              <strong>
                {screen === "focus"
                  ? "Do now"
                  : screen === "project"
                    ? "Project details"
                    : screen === "queue"
                      ? "Master list"
                      : screen.charAt(0).toUpperCase() + screen.slice(1)}
              </strong>
            </div>
            <div className="header-actions">
              <span className="local-badge">
                <span />
                {workspace.mode === "cloud"
                  ? "Personal space"
                  : "Local workspace"}
              </span>
              <button
                className="icon-button mobile-settings"
                aria-label="Settings"
                onClick={() => navigate("settings")}
              >
                <Settings size={20} />
              </button>
              <button
                className="add-top"
                aria-label="Add item"
                onClick={() =>
                  setModal({
                    kind: "item",
                    projectId: screen === "project" ? projectId : undefined,
                  })
                }
              >
                <Plus size={18} />
                <span>Add item</span>
              </button>
            </div>
          </header>
          {workspace.error && (
            <div className="sync-warning" role="status">
              <Cloud size={17} />
              <span>{workspace.error}</span>
              <button onClick={() => navigate("settings")}>Details</button>
            </div>
          )}
          {!workspace.ready ? (
            <div className="loading-state">
              <LoaderCircle className="spin" />
              Opening your space…
            </div>
          ) : (
            <main id="main-content" className="app-content">
              {screen === "home" && (
                <>
                  <div className="home-intro">
                    <div>
                      <p className="eyebrow">
                        {new Date().toLocaleDateString(undefined, {
                          weekday: "long",
                          month: "long",
                          day: "numeric",
                        })}
                      </p>
                      <h1>
                        {design.id === "orbit"
                          ? "Welcome to your space"
                          : design.id === "pop"
                            ? `Hey, ${state.profile.name || "you"}.`
                            : `Welcome, ${state.profile.name || "friend"}.`}
                        <span className="greeting-mark">
                          {design.id === "ember" ? (
                            <Sun />
                          ) : design.id === "orbit" ? (
                            <Sparkles />
                          ) : design.id === "pop" ? (
                            <Zap />
                          ) : (
                            <Leaf />
                          )}
                        </span>
                      </h1>
                      <p className="muted">{design.description}</p>
                    </div>
                    <Avatar profile={state.profile} large />
                  </div>
                  <section className={`home-hero hero-${design.id}`}>
                    <div className="hero-art" aria-hidden="true">
                      {design.id === "still" ? (
                        <>
                          <div className="botanical-disc" />
                          <Botanical />
                        </>
                      ) : design.id === "ember" ? (
                        <div className="ember-sun">
                          <div />
                          <div />
                          <div />
                        </div>
                      ) : design.id === "orbit" ? (
                        <div className="orbit-art">
                          <div className="orbital-ring ring-one" />
                          <div className="orbital-ring ring-two" />
                          <div className="orbit-planet" />
                          <span className="star star-one">✦</span>
                          <span className="star star-two">✦</span>
                        </div>
                      ) : design.id === "tide" ? (
                        <div className="tide-art">
                          <span />
                          <span />
                          <span />
                        </div>
                      ) : (
                        <div className="pop-art">
                          <span>✳</span>
                          <div>
                            ONE
                            <br />
                            BITE.
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="hero-content">
                      <div className="hero-kicker">
                        {design.id === "orbit" ? (
                          <Moon size={15} />
                        ) : design.id === "pop" ? (
                          <Zap size={15} />
                        ) : (
                          <span className="tiny-dot" />
                        )}
                        <span>
                          {design.id === "pop"
                            ? "LET’S MAKE A LITTLE PROGRESS"
                            : "YOUR NEXT SMALL STEP"}
                        </span>
                      </div>
                      <h2>
                        {design.id === "still" ? (
                          <>
                            One thing.
                            <br />
                            <em>At your own pace.</em>
                          </>
                        ) : design.id === "ember" ? (
                          <>
                            Good things
                            <br />
                            start <em>small.</em>
                          </>
                        ) : design.id === "orbit" ? (
                          <>
                            Less noise.
                            <br />
                            <em>More focus.</em>
                          </>
                        ) : design.id === "tide" ? (
                          <>
                            A clearer mind.
                            <br />
                            <em>A smaller step.</em>
                          </>
                        ) : (
                          <>
                            BIG THINGS.
                            <br />
                            <span>SMALL BITES.</span>
                          </>
                        )}
                      </h2>
                      <p>
                        {design.id === "orbit"
                          ? "Let the rest of the world wait a moment."
                          : "You don’t have to do it all. Just the next little thing."}
                      </p>
                      <button
                        className="primary-button start-button"
                        onClick={() => navigate("focus")}
                      >
                        {current ? "Start working" : "Find your next step"}
                        <ArrowRight size={19} />
                      </button>
                      <span className="hero-footnote">
                        {current
                          ? "Just one item. That’s all you need to see."
                          : "A fresh page. Add something you’d like to do."}
                      </span>
                    </div>
                  </section>
                  <div className="home-lower">
                    <section className="daily-note">
                      <span className="note-icon">
                        <CheckCheck size={23} />
                      </span>
                      <div>
                        <strong>
                          {completedToday === 0
                            ? "Every little step counts."
                            : `${completedToday} little ${completedToday === 1 ? "step" : "steps"} forward today.`}
                        </strong>
                        <p>
                          {completedToday === 0
                            ? "Your progress starts with one small thing."
                            : "Take a breath. Look how far you’ve come."}
                        </p>
                      </div>
                      {completedToday > 0 && (
                        <span className="daily-number">
                          {String(completedToday).padStart(2, "0")}
                        </span>
                      )}
                    </section>
                    <div className="home-links">
                      <button
                        className="home-link"
                        onClick={() => navigate("projects")}
                      >
                        <span className="link-icon">
                          <Layers size={21} />
                        </span>
                        <span>
                          <strong>Manage projects</strong>
                          <small>
                            {activeProjects.length} active{" "}
                            {activeProjects.length === 1
                              ? "project"
                              : "projects"}
                          </small>
                        </span>
                        <ArrowUpRight size={20} />
                      </button>
                      <button
                        className="home-link"
                        onClick={() => navigate("completed")}
                      >
                        <span className="link-icon">
                          <CircleCheck size={21} />
                        </span>
                        <span>
                          <strong>Little wins</strong>
                          <small>Your completed items</small>
                        </span>
                        <ArrowUpRight size={20} />
                      </button>
                      <button
                        className="home-link settings-home-link"
                        onClick={() => navigate("settings")}
                      >
                        <span className="link-icon">
                          <Settings size={21} />
                        </span>
                        <span>
                          <strong>Make yourself at home</strong>
                          <small>Settings & your data</small>
                        </span>
                        <ArrowUpRight size={20} />
                      </button>
                    </div>
                  </div>
                  {state.settings.showMasterList && (
                    <button
                      className="text-button master-link"
                      onClick={() => navigate("queue")}
                    >
                      <List size={17} />
                      View master list
                      <ArrowRight size={16} />
                    </button>
                  )}
                  <footer className="app-footnote">
                    <Elephant size={22} />
                    <span>How do you eat an elephant? One bite at a time.</span>
                  </footer>
                </>
              )}

              {screen === "focus" && (
                <div className="focus-page">
                  <div className="focus-top">
                    <button
                      className="text-button"
                      onClick={() => navigate("home")}
                    >
                      <ArrowLeft size={17} />
                      Back home
                    </button>
                    <div className="focus-tools">
                      <span className="focus-mode">
                        <span />A MOMENT OF FOCUS
                      </span>
                      {current && (
                        <DuplicateButton
                          item={current.item}
                          onDuplicate={() => duplicate(current.item)}
                        />
                      )}
                    </div>
                  </div>
                  {current ? (
                    <>
                      <div className="focus-center">
                        <div className="focus-symbol">
                          {design.id === "orbit" ? (
                            <Moon size={27} />
                          ) : design.id === "ember" ? (
                            <Sun size={27} />
                          ) : design.id === "pop" ? (
                            <Zap size={27} />
                          ) : (
                            <Leaf size={27} />
                          )}
                        </div>
                        <p className="eyebrow">JUST THIS ONE THING</p>
                        <div className="focus-frame" key={current.item.id}>
                          <span className="frame-corner corner-tl" />
                          <span className="frame-corner corner-tr" />
                          <h1>{current.item.title}</h1>
                          <span className="frame-corner corner-bl" />
                          <span className="frame-corner corner-br" />
                        </div>
                        {current.project && (
                          <p className="focus-project">
                            <Folder size={15} />
                            {current.project.name}
                          </p>
                        )}
                        <p className="focus-reassurance">
                          Everything else can wait.
                        </p>
                      </div>
                      <div className="focus-bottom">
                        <div className="focus-actions">
                          <button
                            className="bite-button"
                            onClick={() => setModal({ kind: "bite" })}
                          >
                            <Scissors size={21} />
                            <span>
                              Take a bite<small>Make it smaller</small>
                            </span>
                          </button>
                          <button
                            className="complete-button"
                            onClick={() =>
                              mutate(
                                completeCurrent,
                                "One small step, done. Beautiful.",
                              )
                            }
                          >
                            <Check size={23} />
                            <span>
                              Completed!
                              <small>On to the next little thing</small>
                            </span>
                          </button>
                        </div>
                        <p>
                          Too much for right now? Take a bite and break it into
                          two.
                        </p>
                      </div>
                    </>
                  ) : (
                    <EmptyState
                      icon={<Sun size={40} />}
                      title="A little breathing room."
                      description="You’ve reached the end of your active items. Add a new one or activate a project when you’re ready."
                      action={
                        <button
                          className="primary-button"
                          onClick={() => setModal({ kind: "item" })}
                        >
                          <Plus size={18} />
                          Add an item
                        </button>
                      }
                    />
                  )}
                </div>
              )}

              {screen === "projects" && (
                <>
                  <PageHeading
                    eyebrow="ROOM FOR THE BIGGER PICTURE"
                    title="Your projects"
                    description="Big ideas, made of little steps."
                    action={
                      <button
                        className="primary-button compact"
                        onClick={() => setModal({ kind: "project" })}
                      >
                        <Plus size={18} />
                        Add project
                      </button>
                    }
                  />
                  <div className="list-toolbar">
                    <div
                      className="tabs"
                      role="tablist"
                      aria-label="Project status"
                    >
                      <button
                        role="tab"
                        aria-selected={projectTab === "active"}
                        onClick={() => setProjectTab("active")}
                      >
                        Active<span>{activeProjects.length}</span>
                      </button>
                      <button
                        role="tab"
                        aria-selected={projectTab === "inactive"}
                        onClick={() => setProjectTab("inactive")}
                      >
                        Upcoming
                        <span>
                          {
                            state.projects.filter(
                              (p) => p.status === "inactive",
                            ).length
                          }
                        </span>
                      </button>
                    </div>
                    <label className="sort-control">
                      Sort by
                      <select
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="name">Name</option>
                        <option value="created">Date created</option>
                        <option value="due">Due date</option>
                      </select>
                      <ChevronDown size={14} />
                    </label>
                  </div>
                  <div className="project-grid">
                    {state.projects
                      .filter((p) => p.status === projectTab)
                      .sort((a, b) =>
                        sort === "name"
                          ? a.name.localeCompare(b.name)
                          : sort === "due"
                            ? (a.dueDate || "9999").localeCompare(
                                b.dueDate || "9999",
                              )
                            : b.createdAt.localeCompare(a.createdAt),
                      )
                      .map((p, index) => {
                        const items = state.items.filter(
                          (i) => i.projectId === p.id,
                        );
                        const done = items.filter((i) => i.completedAt).length;
                        return (
                          <article
                            className="project-card"
                            key={p.id}
                            aria-label={p.name}
                          >
                            <button
                              className="project-card-open"
                              aria-label={`Open project ${p.name}`}
                              onClick={() => navigate("project", p.id)}
                            >
                              <div className="project-card-top">
                                <span
                                  className={`project-glyph glyph-${index % 4}`}
                                >
                                  <Folder size={22} />
                                </span>
                              </div>
                              <h2>{p.name}</h2>
                              <p>
                                {items.length
                                  ? `${done} of ${items.length} little steps completed`
                                  : "A fresh space for your next idea"}
                              </p>
                              <div className="progress-track">
                                <span
                                  style={{
                                    width: `${items.length ? (done / items.length) * 100 : 0}%`,
                                  }}
                                />
                              </div>
                              <div className="project-meta">
                                <span>
                                  {p.dueDate
                                    ? `Due ${formatDate(p.dueDate + "T12:00:00")}`
                                    : "At your own pace"}
                                </span>
                                <span>{items.length - done} left</span>
                              </div>
                            </button>
                            <button
                              className="icon-button project-card-delete"
                              aria-label={`Delete project ${p.name}`}
                              title="Delete project"
                              onClick={() =>
                                setModal({ kind: "deleteProject", project: p })
                              }
                            >
                              <Trash2 size={18} />
                            </button>
                          </article>
                        );
                      })}
                  </div>
                  {!state.projects.some((p) => p.status === projectTab) && (
                    <EmptyState
                      icon={<Layers size={34} />}
                      title={
                        projectTab === "active"
                          ? "Make space for an idea."
                          : "Something for later."
                      }
                      description={
                        projectTab === "active"
                          ? "Create a project, then add a few small steps."
                          : "Pause a project to keep it here until you’re ready."
                      }
                      action={
                        <button
                          className="primary-button"
                          onClick={() => setModal({ kind: "project" })}
                        >
                          <Plus size={18} />
                          Add project
                        </button>
                      }
                    />
                  )}
                </>
              )}

              {screen === "project" &&
                (project ? (
                  <>
                    <div className="project-page-actions">
                      <button
                        className="text-button page-back"
                        onClick={() => {
                          if (project.status === "completed")
                            setCompletedTab("projects");
                          navigate(
                            project.status === "completed"
                              ? "completed"
                              : "projects",
                          );
                        }}
                      >
                        <ArrowLeft size={17} />
                        {project.status === "completed"
                          ? "Completed projects"
                          : "Your projects"}
                      </button>
                      <button
                        className="danger-text project-delete-action"
                        onClick={() =>
                          setModal({ kind: "deleteProject", project })
                        }
                      >
                        <Trash2 size={16} />
                        Delete project
                      </button>
                    </div>
                    <div className="project-detail-heading">
                      <span className="project-glyph">
                        <Folder size={25} />
                      </span>
                      <span className="status-label">
                        {project.status === "inactive"
                          ? "UPCOMING PROJECT"
                          : `${project.status.toUpperCase()} PROJECT`}
                      </span>
                    </div>
                    <form
                      className="project-title-form"
                      key={project.id + project.name}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const name = new FormData(e.currentTarget).get(
                          "projectName",
                        ) as string;
                        mutate(
                          (s) => updateProject(s, project.id, { name }),
                          "Project name saved.",
                        );
                      }}
                    >
                      <label className="sr-only" htmlFor="projectName">
                        Project name
                      </label>
                      <input
                        id="projectName"
                        name="projectName"
                        defaultValue={project.name}
                        maxLength={200}
                        required
                      />
                      <button
                        className="icon-button"
                        title="Save project name"
                        aria-label="Save project name"
                      >
                        <Check size={20} />
                      </button>
                    </form>
                    <div className="project-attributes">
                      <span>Created {formatDate(project.createdAt)}</span>
                      <label>
                        Due date
                        <input
                          aria-label="Project due date"
                          type="date"
                          value={project.dueDate || ""}
                          onChange={(e) =>
                            mutate((s) =>
                              updateProject(s, project.id, {
                                dueDate: e.target.value || null,
                              }),
                            )
                          }
                        />
                      </label>
                      <button
                        className="text-button"
                        onClick={() =>
                          mutate(
                            (s) =>
                              updateProject(s, project.id, {
                                status:
                                  project.status === "active"
                                    ? "inactive"
                                    : "active",
                              }),
                            project.status === "active"
                              ? "Project moved to upcoming."
                              : project.status === "completed"
                                ? "Project reopened."
                                : "Project activated.",
                          )
                        }
                      >
                        {project.status === "active"
                          ? "Move to upcoming"
                          : project.status === "completed"
                            ? "Reopen project"
                            : "Activate project"}
                        <ArrowRight size={14} />
                      </button>
                      {project.status !== "completed" && (
                        <button
                          type="button"
                          className="secondary-button project-complete-action"
                          onClick={() =>
                            setModal({ kind: "completeProject", project })
                          }
                        >
                          <CircleCheck size={17} />
                          Mark project complete
                        </button>
                      )}
                    </div>
                    <div className="section-heading">
                      <h2>One step, then another.</h2>
                      <span>{remainingProjectItems.length} remaining</span>
                    </div>
                    {remainingProjectItems.length ? (
                      <p className="small muted reorder-help">
                        Hold a handle to reorder. Select a step to add one after
                        it.
                      </p>
                    ) : (
                      <p className="small muted project-empty-note">
                        {project.status === "completed"
                          ? "This project is complete. Adding a step will reopen it."
                          : "No unfinished steps. Add more whenever you’re ready, or mark this project complete."}
                      </p>
                    )}
                    <div className="project-items">
                      {remainingProjectItems.map((item, index, items) => (
                        <ProjectItem
                          key={item.id}
                          item={item}
                          index={index}
                          count={items.length}
                          selected={selectedItem === item.id}
                          onSelect={() =>
                            setSelectedItem(
                              selectedItem === item.id ? null : item.id,
                            )
                          }
                          onRename={() => setModal({ kind: "rename", item })}
                          onDelete={() => setModal({ kind: "delete", item })}
                          onDuplicate={() => duplicate(item)}
                          onReorder={(direction) =>
                            mutate((s) => reorderItem(s, item.id, direction))
                          }
                          onMove={(target) =>
                            mutate((s) => moveItem(s, item.id, target))
                          }
                        />
                      ))}
                    </div>
                    <button
                      className="add-project-item"
                      onClick={() =>
                        setModal({
                          kind: "item",
                          projectId: project.id,
                          afterId: selectedItem || undefined,
                        })
                      }
                    >
                      <Plus size={19} />
                      {selectedItem
                        ? "Add an item after selected step"
                        : "Add a little step"}
                    </button>
                    {state.items.some(
                      (i) => i.projectId === project.id && i.completedAt,
                    ) && (
                      <details className="finished-details">
                        <summary>
                          {
                            state.items.filter(
                              (i) =>
                                i.projectId === project.id && i.completedAt,
                            ).length
                          }{" "}
                          completed steps
                          <ChevronDown size={16} />
                        </summary>
                        {state.items
                          .filter(
                            (i) => i.projectId === project.id && i.completedAt,
                          )
                          .map((item) => (
                            <div className="finished-step" key={item.id}>
                              <CircleCheck size={17} />
                              <span>{item.title}</span>
                              <small>{formatDate(item.completedAt!)}</small>
                              <DuplicateButton
                                item={item}
                                onDuplicate={() => duplicate(item)}
                              />
                            </div>
                          ))}
                      </details>
                    )}
                    {formError && (
                      <p className="form-error" role="alert">
                        {formError}
                      </p>
                    )}
                  </>
                ) : (
                  <EmptyState
                    icon={<Folder size={36} />}
                    title="This project isn’t here."
                    description="It may have been removed from your workspace."
                    action={
                      <button
                        className="primary-button"
                        onClick={() => navigate("projects")}
                      >
                        Back to projects
                      </button>
                    }
                  />
                ))}

              {screen === "completed" && (
                <>
                  <PageHeading
                    eyebrow="LOOK HOW FAR YOU’VE COME"
                    title="Little wins"
                    description="A record of the things you made happen."
                  />
                  <div className="wins-banner">
                    <span className="wins-icon">
                      <CheckCheck size={30} />
                    </span>
                    <div>
                      <strong>
                        {completedToday
                          ? `${completedToday} little ${completedToday === 1 ? "win" : "wins"} today.`
                          : "Progress, at your own pace."}
                      </strong>
                      <p>
                        {completedItems.length}{" "}
                        {completedItems.length === 1 ? "item" : "items"}{" "}
                        completed, one step at a time.
                      </p>
                    </div>
                    <span className="wins-decoration">✧</span>
                  </div>
                  <div className="list-toolbar">
                    <div
                      className="tabs"
                      role="tablist"
                      aria-label="Completed list"
                    >
                      <button
                        role="tab"
                        aria-selected={completedTab === "items"}
                        onClick={() => setCompletedTab("items")}
                      >
                        Items<span>{completedItems.length}</span>
                      </button>
                      <button
                        role="tab"
                        aria-selected={completedTab === "projects"}
                        onClick={() => setCompletedTab("projects")}
                      >
                        Projects
                        <span>
                          {
                            state.projects.filter(
                              (p) => p.status === "completed",
                            ).length
                          }
                        </span>
                      </button>
                    </div>
                    <label className="search-box">
                      <Search size={17} />
                      <input
                        aria-label="Search completed entries"
                        placeholder="Find a little win"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="completed-list">
                    {completedTab === "items"
                      ? completedItems
                          .filter((i) =>
                            i.title
                              .toLowerCase()
                              .includes(search.toLowerCase()),
                          )
                          .map((item) => (
                            <div className="completed-row" key={item.id}>
                              <span className="completed-check">
                                <Check size={17} />
                              </span>
                              <div>
                                <strong>{item.title}</strong>
                                <p>
                                  {state.projects.find(
                                    (p) => p.id === item.projectId,
                                  )?.name ||
                                    (item.deletedProjectName
                                      ? `${item.deletedProjectName} (deleted project)`
                                      : "Errand")}
                                </p>
                                <time dateTime={item.completedAt!}>
                                  {formatDate(item.completedAt!, true)}
                                </time>
                              </div>
                              <span className="completed-actions">
                                <button
                                  type="button"
                                  className="secondary-button put-back-item"
                                  aria-label={`Put back ${item.title}`}
                                  title="Restore to the front of Do now"
                                  onClick={() =>
                                    mutate(
                                      (s) => putBackItem(s, item.id),
                                      "Item put back at the front of Do now.",
                                    )
                                  }
                                >
                                  <RotateCcw size={16} />
                                  Put back
                                </button>
                                <DuplicateButton
                                  item={item}
                                  onDuplicate={() => duplicate(item)}
                                />
                              </span>
                            </div>
                          ))
                      : state.projects
                          .filter(
                            (p) =>
                              p.status === "completed" &&
                              p.name
                                .toLowerCase()
                                .includes(search.toLowerCase()),
                          )
                          .map((p) => (
                            <button
                              className="completed-row completed-project"
                              key={p.id}
                              onClick={() => navigate("project", p.id)}
                            >
                              <span className="completed-check">
                                <Folder size={17} />
                              </span>
                              <div>
                                <strong>{p.name}</strong>
                                <p>
                                  {p.completedAt
                                    ? formatDate(p.completedAt, true)
                                    : "Completed"}
                                </p>
                              </div>
                              <ArrowUpRight size={18} />
                            </button>
                          ))}
                  </div>
                  {formError && (
                    <p className="form-error" role="alert">
                      {formError}
                    </p>
                  )}
                  {(completedTab === "items"
                    ? !completedItems.some((i) =>
                        i.title.toLowerCase().includes(search.toLowerCase()),
                      )
                    : !state.projects.some(
                        (p) =>
                          p.status === "completed" &&
                          p.name.toLowerCase().includes(search.toLowerCase()),
                      )) && (
                    <EmptyState
                      icon={<CircleCheck size={36} />}
                      title={
                        search
                          ? "No matching wins."
                          : "Your little wins will live here."
                      }
                      description={
                        search
                          ? "Try a different word."
                          : "Complete your first item when you’re ready. Every step counts."
                      }
                    />
                  )}
                </>
              )}

              {screen === "queue" && (
                <>
                  <PageHeading
                    eyebrow="THE BIGGER PICTURE"
                    title="Master list"
                    description="View with care. You only need to do one thing at a time."
                    action={
                      <button
                        className="primary-button compact"
                        onClick={() => navigate("focus")}
                      >
                        Back to one item
                        <ArrowRight size={17} />
                      </button>
                    }
                  />
                  <p className="queue-note">
                    <Leaf size={17} />
                    This is your current queue. Project steps keep their
                    reserved places as you edit them.
                  </p>
                  <div className="queue-list">
                    {queue.map((entry, index) => (
                      <div className="queue-row" key={entry.slot.id}>
                        <span className="queue-index">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <strong>{entry.item.title}</strong>
                          <small>{entry.project?.name || "Errand"}</small>
                        </div>
                        {index === 0 && (
                          <span className="now-badge">DO NOW</span>
                        )}
                        <button
                          className="icon-button"
                          aria-label={`Edit ${entry.item.title}`}
                          onClick={() =>
                            setModal({ kind: "rename", item: entry.item })
                          }
                        >
                          <ChevronRight size={19} />
                        </button>
                        <button
                          className="icon-button subtle-delete"
                          aria-label={`Delete ${entry.item.title}`}
                          onClick={() =>
                            setModal({ kind: "delete", item: entry.item })
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                        <DuplicateButton
                          item={entry.item}
                          onDuplicate={() => duplicate(entry.item)}
                        />
                      </div>
                    ))}
                  </div>
                  {!queue.length && (
                    <EmptyState
                      icon={<List size={36} />}
                      title="A clear page."
                      description="Add an errand or an active project to get started."
                    />
                  )}
                </>
              )}

              {screen === "settings" && (
                <>
                  <PageHeading
                    eyebrow="MAKE YOURSELF AT HOME"
                    title="Your space, your way"
                    description="A few simple things to make Elephant yours."
                    action={
                      <button
                        className="primary-button compact"
                        onClick={downloadBackup}
                        disabled={workspace.recoveryNeeded}
                      >
                        <Download size={18} />
                        Download backup
                      </button>
                    }
                  />
                  <div className="settings-sections">
                    <section className="settings-section">
                      <h2>A little about you</h2>
                      <form
                        className="profile-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const name = String(
                            new FormData(e.currentTarget).get("name"),
                          ).trim();
                          if (name)
                            mutate(
                              (s) => ({
                                ...s,
                                profile: { ...s.profile, name },
                              }),
                              "Nice to see you, " + name + ".",
                            );
                        }}
                      >
                        <Avatar profile={state.profile} />
                        <label>
                          Your name
                          <input
                            name="name"
                            defaultValue={state.profile.name}
                            key={state.profile.name}
                            maxLength={60}
                            required
                          />
                        </label>
                        <button className="secondary-button" type="submit">
                          Save
                        </button>
                      </form>
                      <div className="avatar-upload">
                        <button
                          className="text-button"
                          onClick={() => avatarRef.current?.click()}
                        >
                          <Upload size={15} />
                          {state.profile.avatarUrl
                            ? "Change profile photo"
                            : "Add a profile photo"}
                        </button>
                        {state.profile.avatarUrl && (
                          <button
                            className="text-button"
                            onClick={() =>
                              mutate(
                                (s) => ({
                                  ...s,
                                  profile: { name: s.profile.name },
                                }),
                                "Profile photo removed.",
                              )
                            }
                          >
                            Remove photo
                          </button>
                        )}
                        <input
                          className="sr-only"
                          ref={avatarRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          aria-label="Upload a profile photo"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (!file) return;
                            try {
                              if (
                                ![
                                  "image/png",
                                  "image/jpeg",
                                  "image/webp",
                                ].includes(file.type) ||
                                file.size > 10 * 1024 * 1024
                              )
                                throw new Error(
                                  "Choose a JPG, PNG, or WebP photo smaller than 10 MB.",
                                );
                              const bitmap = await createImageBitmap(file);
                              const canvas = document.createElement("canvas");
                              canvas.width = 192;
                              canvas.height = 192;
                              const context = canvas.getContext("2d");
                              if (!context)
                                throw new Error(
                                  "This browser couldn't prepare your photo.",
                                );
                              const side = Math.min(
                                bitmap.width,
                                bitmap.height,
                              );
                              context.drawImage(
                                bitmap,
                                (bitmap.width - side) / 2,
                                (bitmap.height - side) / 2,
                                side,
                                side,
                                0,
                                0,
                                192,
                                192,
                              );
                              bitmap.close();
                              const avatarUrl = canvas.toDataURL(
                                "image/jpeg",
                                0.86,
                              );
                              update((s) => ({
                                ...s,
                                profile: { ...s.profile, avatarUrl },
                              }));
                              setToast("A familiar face. Photo saved.");
                            } catch (error) {
                              setToast((error as Error).message);
                            }
                          }}
                        />
                      </div>
                    </section>
                    <section className="settings-section">
                      <h2>A calmer view</h2>
                      <div className="setting-row">
                        <div>
                          <strong>Show the master list</strong>
                          <p>Add a link to the full queue on your home page.</p>
                        </div>
                        <button
                          className="toggle"
                          role="switch"
                          aria-checked={state.settings.showMasterList}
                          aria-label="Show the master list"
                          onClick={() =>
                            mutate((s) => ({
                              ...s,
                              settings: {
                                ...s.settings,
                                showMasterList: !s.settings.showMasterList,
                              },
                            }))
                          }
                        >
                          <span />
                        </button>
                      </div>
                    </section>
                    <section className="settings-section">
                      <h2>
                        <Cloud size={19} />
                        Your workspace
                      </h2>
                      <p className="muted small">{workspace.syncStatus}</p>
                      {workspace.error && (
                        <p className="form-error" role="alert">
                          {workspace.error}
                        </p>
                      )}
                      {workspace.userEmail ? (
                        <>
                          <div className="setting-row">
                            <div>
                              <strong>{workspace.userEmail}</strong>
                              <p>Your items travel with you.</p>
                            </div>
                            <button
                              className="secondary-button"
                              onClick={() => {
                                void workspace
                                  .signOut()
                                  .catch((e) => setEmailStatus(e.message));
                              }}
                            >
                              <LogOut size={16} />
                              Sign out
                            </button>
                          </div>
                          <button
                            className="text-button"
                            onClick={workspace.retrySync}
                          >
                            <RotateCcw size={15} />
                            Retry sync
                          </button>
                        </>
                      ) : workspace.configured ? (
                        <form
                          className="signin-form"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            setSending(true);
                            setEmailStatus("");
                            try {
                              await workspace.signIn(
                                String(
                                  new FormData(e.currentTarget).get("email"),
                                ),
                              );
                              setEmailStatus(
                                "Check your email for a sign-in link. Your account opens a separate personal workspace.",
                              );
                            } catch (e) {
                              setEmailStatus((e as Error).message);
                            } finally {
                              setSending(false);
                            }
                          }}
                        >
                          <label>
                            Email address
                            <input
                              type="email"
                              name="email"
                              placeholder="you@example.com"
                              autoComplete="email"
                              required
                            />
                          </label>
                          <button className="primary-button" disabled={sending}>
                            {sending ? (
                              <LoaderCircle className="spin" size={18} />
                            ) : (
                              <ArrowUpRight size={18} />
                            )}
                            Send sign-in link
                          </button>
                          <p className="small muted">
                            Use a personal account to keep your items across
                            devices. Your local workspace stays separate.
                          </p>
                        </form>
                      ) : (
                        <p className="small local-explanation">
                          Your changes are saved in this browser. Account sync
                          will be available when this app’s Supabase connection
                          is configured. Export a backup to keep a copy.
                        </p>
                      )}
                      {emailStatus && (
                        <p className="inline-message" role="status">
                          {emailStatus}
                        </p>
                      )}
                    </section>
                    <section className="settings-section">
                      <h2>Backups & exports</h2>
                      <p className="muted small">
                        Keep a JSON copy somewhere safe. Restore it here if you
                        ever need to recover your workspace.
                      </p>
                      {workspace.recoveryNeeded && (
                        <p className="inline-message" role="status">
                          Your saved workspace couldn’t be read, so backup
                          downloads are paused. Restore a previously downloaded
                          JSON backup below.
                        </p>
                      )}
                      <button
                        className="data-action"
                        onClick={downloadBackup}
                        disabled={workspace.recoveryNeeded}
                      >
                        <Download size={20} />
                        <span>
                          <strong>Download JSON backup</strong>
                          <small>
                            All projects, items, queue order, history, profile,
                            and settings
                          </small>
                        </span>
                        <ArrowUpRight size={18} />
                      </button>
                      <button
                        className="data-action"
                        onClick={() => importRef.current?.click()}
                      >
                        <Upload size={20} />
                        <span>
                          <strong>Restore JSON backup</strong>
                          <small>
                            Restore your space from an Elephant JSON file
                          </small>
                        </span>
                        <ArrowUpRight size={18} />
                      </button>
                      <input
                        className="sr-only"
                        ref={importRef}
                        type="file"
                        accept="application/json,.json"
                        aria-label="Import an Elephant backup"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file) return;
                          try {
                            if (file.size > 10 * 1024 * 1024)
                              throw new Error(
                                "Choose a backup smaller than 10 MB.",
                              );
                            setModal({
                              kind: "import",
                              data: validateImport(
                                JSON.parse(await file.text()),
                              ),
                            });
                          } catch (e) {
                            setToast(
                              "Could not import: " + (e as Error).message,
                            );
                          }
                        }}
                      />
                      <div className="csv-export">
                        <label>
                          Export a list
                          <select
                            value={csvList}
                            onChange={(e) =>
                              setCsvList(e.target.value as typeof csvList)
                            }
                          >
                            <option value="completed">Completed items</option>
                            <option value="completedProjects">
                              Completed projects
                            </option>
                            <option value="queue">Master list</option>
                            <option value="active">Active projects</option>
                            <option value="inactive">Upcoming projects</option>
                            <option value="items">
                              All project items & errands
                            </option>
                          </select>
                        </label>
                        <button
                          className="secondary-button"
                          onClick={() =>
                            downloadFile(
                              exportCsv(state, csvList),
                              `elephant-${csvList}.csv`,
                              "text/csv;charset=utf-8;",
                            )
                          }
                        >
                          <ArrowDownToLine size={17} />
                          Export CSV
                        </button>
                      </div>
                    </section>
                    <section className="settings-section reset-section">
                      <div>
                        <h2>A fresh start</h2>
                        <p>
                          Clear all items, projects, and completion history.
                        </p>
                      </div>
                      <button
                        className="danger-text"
                        onClick={() => setModal({ kind: "reset" })}
                      >
                        <RotateCcw size={16} />
                        Reset workspace
                      </button>
                    </section>
                  </div>
                </>
              )}
            </main>
          )}
        </div>
      </div>
      {nav(true)}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {modal && (
        <Sheet
          title={
            modal.kind === "item"
              ? "One little thing."
              : modal.kind === "project"
                ? "Make room for an idea."
                : modal.kind === "bite"
                  ? "A smaller bite."
                  : modal.kind === "rename"
                    ? "Edit your item"
                    : modal.kind === "delete"
                      ? "Remove this item?"
                      : modal.kind === "deleteProject"
                        ? "Delete this project?"
                        : modal.kind === "completeProject"
                          ? "Complete this project?"
                          : modal.kind === "import"
                            ? "Restore this workspace?"
                            : "Ready for a fresh start?"
          }
          description={
            modal.kind === "bite"
              ? "Make the first step a little easier. The rest will be waiting for you."
              : modal.kind === "item"
                ? "An errand for today, or a step toward something bigger."
                : modal.kind === "project"
                  ? "Give your project a name. We’ll take it one step at a time."
                  : modal.kind === "import"
                    ? `This backup has ${modal.data.projects.length} projects and ${modal.data.items.length} items. It will replace all current workspace data.`
                    : modal.kind === "reset"
                      ? "This deletes all items, projects, and history in this workspace. Export a backup first if you want to keep them."
                      : modal.kind === "delete"
                        ? "This item will be removed from the project and queue. This can’t be undone."
                        : modal.kind === "deleteProject"
                          ? "This permanently deletes the project and its unfinished items, removing them from the active queue. Completed items will stay in your history."
                          : modal.kind === "completeProject"
                            ? state.items.some(
                                (item) =>
                                  item.projectId === modal.project.id &&
                                  !item.completedAt,
                              )
                              ? "This will mark the project and its remaining items as completed and remove them from Do now. You can reopen the project later."
                              : "Move this project to Completed. You can reopen it later."
                            : undefined
          }
          onClose={() => {
            if (!restoring) setModal(null);
          }}
        >
          {["item", "project", "bite", "rename"].includes(modal.kind) && (
            <form onSubmit={submitForm} className="sheet-form">
              {modal.kind === "item" && (
                <>
                  <label>
                    What would you like to do?
                    <textarea
                      name="title"
                      placeholder="Something small is a good place to start…"
                      rows={3}
                      maxLength={500}
                      autoFocus
                      required
                    />
                  </label>
                  <label>
                    A little step in
                    <select
                      name="projectId"
                      defaultValue={modal.projectId || ""}
                    >
                      <option value="">Just an errand</option>
                      {state.projects
                        .filter(
                          (p) =>
                            p.status !== "completed" ||
                            p.id === modal.projectId,
                        )
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.status === "inactive" ? " (upcoming)" : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                  {modal.afterId && (
                    <p className="small muted">
                      Added directly after your selected step when using the
                      same project.
                    </p>
                  )}
                </>
              )}
              {modal.kind === "project" && (
                <label>
                  Project name
                  <input
                    autoFocus
                    name="name"
                    placeholder="A little idea with room to grow"
                    maxLength={200}
                    required
                  />
                </label>
              )}
              {modal.kind === "rename" && (
                <label>
                  Item name
                  <textarea
                    name="title"
                    defaultValue={modal.item.title}
                    rows={3}
                    maxLength={500}
                    autoFocus
                    required
                  />
                </label>
              )}
              {modal.kind === "bite" && current && (
                <>
                  <label>
                    <span className="field-step">01</span>What can you do right
                    now?
                    <textarea
                      name="first"
                      defaultValue={current.item.title}
                      rows={3}
                      maxLength={500}
                      autoFocus
                      required
                    />
                  </label>
                  <div className="split-connector">
                    <ArrowDown size={18} />
                  </div>
                  <label>
                    <span className="field-step">02</span>What will you do after
                    that?
                    <textarea
                      name="remainder"
                      placeholder="Leave the next little step here…"
                      rows={3}
                      maxLength={500}
                      required
                    />
                  </label>
                  <div className="bite-explainer">
                    <Leaf size={17} />
                    <p>
                      {current.project
                        ? "The next step stays right after this one in your project."
                        : "The next step joins the end of your queue."}{" "}
                      Your first step stays open until you mark it completed.
                    </p>
                  </div>
                </>
              )}
              {formError && (
                <p className="form-error" role="alert">
                  {formError}
                </p>
              )}
              <div className="sheet-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button className="primary-button" type="submit">
                  {modal.kind === "bite"
                    ? "Make it smaller"
                    : modal.kind === "project"
                      ? "Create project"
                      : modal.kind === "rename"
                        ? "Save changes"
                        : "Add item"}
                  {modal.kind === "bite" ? (
                    <Scissors size={17} />
                  ) : (
                    <Plus size={17} />
                  )}
                </button>
              </div>
            </form>
          )}
          {modal.kind === "completeProject" && (
            <>
              <p className="confirm-item">{modal.project.name}</p>
              {formError && (
                <p className="form-error" role="alert">
                  {formError}
                </p>
              )}
              <div className="sheet-actions complete-project-confirm">
                <button
                  className="secondary-button"
                  onClick={() => setModal(null)}
                >
                  Keep project open
                </button>
                <button
                  className="primary-button"
                  onClick={() => {
                    try {
                      update((s) =>
                        updateProject(s, modal.project.id, {
                          status: "completed",
                        }),
                      );
                      setModal(null);
                      setSelectedItem(null);
                      setToast("Project marked complete.");
                    } catch (error) {
                      setFormError(
                        error instanceof Error
                          ? error.message
                          : "Could not complete this project. Please try again.",
                      );
                    }
                  }}
                >
                  <CircleCheck size={17} />
                  Mark project complete
                </button>
              </div>
            </>
          )}
          {modal.kind === "deleteProject" && (
            <>
              <p className="confirm-item">{modal.project.name}</p>
              {formError && (
                <p className="form-error" role="alert">
                  {formError}
                </p>
              )}
              <div className="sheet-actions">
                <button
                  className="secondary-button"
                  onClick={() => setModal(null)}
                >
                  Keep project
                </button>
                <button
                  className="danger-button"
                  onClick={() => {
                    try {
                      update((s) => deleteProject(s, modal.project.id));
                      setModal(null);
                      setToast("Project deleted. Completed items kept.");
                      if (screen === "project") {
                        if (modal.project.status === "completed") {
                          setCompletedTab("projects");
                          navigate("completed");
                        } else {
                          setProjectTab(modal.project.status);
                          navigate("projects");
                        }
                      }
                    } catch (error) {
                      setFormError(
                        error instanceof Error
                          ? error.message
                          : "Could not delete this project. Please try again.",
                      );
                    }
                  }}
                >
                  <Trash2 size={17} />
                  Delete project
                </button>
              </div>
            </>
          )}
          {modal.kind === "delete" && (
            <>
              <p className="confirm-item">{modal.item.title}</p>
              <div className="sheet-actions">
                <button
                  className="secondary-button"
                  onClick={() => setModal(null)}
                >
                  Keep item
                </button>
                <button
                  className="danger-button"
                  onClick={() =>
                    submit((s) => deleteItem(s, modal.item.id), "Item removed.")
                  }
                >
                  <Trash2 size={17} />
                  Remove item
                </button>
              </div>
            </>
          )}
          {modal.kind === "reset" && (
            <div className="sheet-actions">
              <button
                className="secondary-button"
                onClick={() => setModal(null)}
              >
                Keep my space
              </button>
              <button
                className="danger-button"
                onClick={() => {
                  const empty = createEmptyState();
                  update({
                    ...empty,
                    profile: state.profile,
                    settings: state.settings,
                  });
                  setModal(null);
                  navigate("home");
                  setToast("A fresh start. One little step at a time.");
                }}
              >
                Reset everything
              </button>
            </div>
          )}
          {modal.kind === "import" && (
            <>
              {formError && (
                <p className="form-error" role="alert">
                  {formError}
                </p>
              )}
              <div className="sheet-actions">
                <button
                  className="secondary-button"
                  onClick={() => setModal(null)}
                  disabled={restoring}
                >
                  Cancel
                </button>
                <button
                  className="danger-button"
                  disabled={restoring}
                  onClick={async () => {
                    setRestoring(true);
                    setFormError("");
                    try {
                      await workspace.restoreBackup(modal.data);
                      setModal(null);
                      navigate("home");
                      setToast("Your workspace has been restored.");
                    } catch (error) {
                      setFormError(
                        error instanceof Error
                          ? error.message
                          : "Could not restore this backup. Please try again.",
                      );
                    } finally {
                      setRestoring(false);
                    }
                  }}
                >
                  {restoring ? (
                    <>
                      <LoaderCircle className="spin" size={17} />
                      Restoring…
                    </>
                  ) : (
                    "Replace current data"
                  )}
                </button>
              </div>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action}
    </header>
  );
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

function ProjectItem({
  item,
  index,
  count,
  selected,
  onSelect,
  onRename,
  onDelete,
  onDuplicate,
  onReorder,
  onMove,
}: {
  item: Item;
  index: number;
  count: number;
  selected: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onReorder: (direction: "up" | "down") => void;
  onMove: (targetId: string) => void;
}) {
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const drag = useRef<{
    timer: number;
    active: boolean;
    target?: string;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(
    () => () => {
      if (drag.current) clearTimeout(drag.current.timer);
    },
    [],
  );
  function startDrag(e: ReactPointerEvent<HTMLButtonElement>) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      active: false,
      timer: window.setTimeout(() => {
        if (drag.current) {
          drag.current.active = true;
          setDragging(true);
        }
      }, 250),
    };
  }
  function moveDrag(e: ReactPointerEvent<HTMLButtonElement>) {
    if (!drag.current?.active) return;
    const target = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest("[data-item-id]")
      ?.getAttribute("data-item-id");
    if (target) drag.current.target = target;
    document
      .querySelectorAll(".drop-target")
      .forEach((el) => el.classList.remove("drop-target"));
    if (target && target !== item.id)
      document
        .querySelector(`[data-item-id="${CSS.escape(target)}"]`)
        ?.classList.add("drop-target");
  }
  function endDrag() {
    if (drag.current) {
      clearTimeout(drag.current.timer);
      if (
        drag.current.active &&
        drag.current.target &&
        drag.current.target !== item.id
      )
        onMove(drag.current.target);
    }
    drag.current = null;
    setDragging(false);
    document
      .querySelectorAll(".drop-target")
      .forEach((el) => el.classList.remove("drop-target"));
  }
  return (
    <div
      className={`project-item ${selected ? "selected" : ""} ${dragging ? "dragging" : ""}`}
      data-item-id={item.id}
      onPointerDown={(e) => {
        swiped.current = false;
        if (
          !(e.target as HTMLElement).closest(
            ".drag-handle, .item-actions, .item-number",
          )
        )
          swipe.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        if (
          swipe.current &&
          e.clientX - swipe.current.x < -70 &&
          Math.abs(e.clientY - swipe.current.y) < 45
        ) {
          swiped.current = true;
          onDelete();
        }
        swipe.current = null;
      }}
      onPointerCancel={() => {
        swipe.current = null;
      }}
    >
      <button
        className="drag-handle"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-label={`Hold to reorder ${item.title}`}
      >
        <GripVertical size={18} />
      </button>
      <button
        className="item-number"
        onClick={onSelect}
        aria-label={`Select step ${index + 1}`}
        aria-pressed={selected}
      >
        {selected ? <Check size={14} /> : String(index + 1).padStart(2, "0")}
      </button>
      <button
        className="item-title"
        onClick={() => {
          if (!swiped.current) onRename();
        }}
      >
        {item.title}
      </button>
      <div className="item-actions">
        <div className="reorder-buttons">
          <button
            className="icon-button"
            aria-label={`Move ${item.title} up`}
            disabled={index === 0}
            onClick={() => onReorder("up")}
          >
            <ArrowUp size={15} />
          </button>
          <button
            className="icon-button"
            aria-label={`Move ${item.title} down`}
            disabled={index === count - 1}
            onClick={() => onReorder("down")}
          >
            <ArrowDown size={15} />
          </button>
        </div>
        <div className="item-secondary-actions">
          <DuplicateButton item={item} onDuplicate={onDuplicate} />
          <button
            className="icon-button subtle-delete"
            aria-label={`Delete ${item.title}`}
            onClick={onDelete}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function DuplicateButton({
  item,
  onDuplicate,
}: {
  item: Item;
  onDuplicate: () => void;
}) {
  return (
    <button
      className="icon-button duplicate-item"
      aria-label={`Duplicate ${item.title}`}
      title="Duplicate item"
      onClick={onDuplicate}
    >
      <Copy size={17} />
    </button>
  );
}

function Avatar({
  profile,
  large = false,
}: {
  profile: AppState["profile"];
  large?: boolean;
}) {
  return (
    <span className={`avatar${large ? " large-avatar" : ""}`}>
      {profile.avatarUrl ? (
        <img src={profile.avatarUrl} alt="Your profile" />
      ) : (
        profile.name.slice(0, 1).toUpperCase() || "Y"
      )}
    </span>
  );
}
