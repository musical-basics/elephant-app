import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronLeft,
  Circle,
  FolderOpen,
  Home,
  Leaf,
  MoreHorizontal,
  Plus,
  Settings2,
  Sparkles,
  Split,
  Sun,
  Wifi,
} from "lucide-react";
import type { DesignId } from "../lib/designs";
import "../gallery.css";

type Concept = {
  id: DesignId;
  number: string;
  name: string;
  character: string;
  description: string;
  colors: string[];
};

const concepts: Concept[] = [
  {
    id: "still",
    number: "01",
    name: "Still",
    character: "A little room to breathe.",
    description: "Quiet typography. Natural colors. Gentle momentum.",
    colors: ["#344b3d", "#a8b698", "#e7e9dc"],
  },
  {
    id: "ember",
    number: "02",
    name: "Ember",
    character: "Progress feels good here.",
    description: "Warm, tactile, and a little more human.",
    colors: ["#b95435", "#e5a57a", "#f6dbbc"],
  },
  {
    id: "orbit",
    number: "03",
    name: "Orbit",
    character: "Find your own gravity.",
    description: "A focused little universe, with you at the center.",
    colors: ["#292d46", "#c4b5fa", "#848cb7"],
  },
  {
    id: "tide",
    number: "04",
    name: "Tide",
    character: "Make space. Move forward.",
    description: "Crisp structure for a clearer head.",
    colors: ["#315fbc", "#9bbbe9", "#d5e4f5"],
  },
  {
    id: "pop",
    number: "05",
    name: "Pop",
    character: "Small steps. Big energy.",
    description: "Bold type, playful shapes, and a cheerful nudge.",
    colors: ["#222617", "#d9ed65", "#f2cc5c"],
  },
];

function ElephantMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="31"
      height="29"
      viewBox="0 0 36 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 25V15.5C6 8.8 10.6 4 17 4H21C26.5 4 30 7.5 30 12.5V21.5C30 24 31 25.5 33 25.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M6 25V28H12V22H22V28H28V20"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21 9C16 8 13 11 13 15C13 19 16 21 20 20V11"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="25.3" cy="12.4" r="1.3" fill="currentColor" />
      <path
        d="M6 14C3 14 2 17 2 20"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Botanical() {
  return (
    <svg
      className="preview-botanical"
      viewBox="0 0 100 125"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M49 123C52 91 54 56 69 12M53 96C38 84 31 70 30 53M56 77C71 69 82 59 87 45M61 49C51 37 46 22 47 11"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M53 97C37 98 22 87 20 74C34 72 50 83 53 97ZM31 63C15 61 10 50 12 38C26 42 32 49 31 63ZM58 74C66 54 76 49 89 48C87 62 74 73 58 74ZM63 39C63 23 69 12 82 8C85 21 76 35 63 39ZM50 29C37 23 36 11 39 2C50 9 54 18 50 29ZM51 111C66 92 75 89 88 91C85 105 71 114 51 111Z"
        fill="currentColor"
        fillOpacity=".08"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function PhoneStatus() {
  return (
    <div className="preview-status">
      <span>9:41</span>
      <span className="preview-status-icons">
        <span className="preview-signal">
          <i />
          <i />
          <i />
          <i />
        </span>
        <Wifi size={12} strokeWidth={2.5} />
        <span className="preview-battery" />
      </span>
    </div>
  );
}

function PhoneNav({ focusLabel = "Focus" }: { focusLabel?: string }) {
  return (
    <div className="preview-nav">
      <span className="preview-nav-active">
        <Home />
        <span>{focusLabel}</span>
      </span>
      <span>
        <FolderOpen />
        <span>Projects</span>
      </span>
      <span>
        <CheckCheck />
        <span>Done</span>
      </span>
      <span>
        <Settings2 />
        <span>Settings</span>
      </span>
    </div>
  );
}

function StillPreview() {
  return (
    <div className="preview-phone preview-still">
      <PhoneStatus />
      <div className="preview-screen-content">
        <div className="preview-app-header">
          <span className="preview-mini-brand">
            <ElephantMark />
            elephant
          </span>
          <span className="preview-round-icon">
            <Plus size={15} />
          </span>
        </div>
        <div className="preview-still-greeting">
          <span className="preview-eyebrow">A MOMENT FOR YOU</span>
          <h3>
            One thing
            <br />
            at a time.
          </h3>
          <Botanical />
        </div>
        <div className="preview-project-label">
          <span className="preview-small-dot" />
          Plan a Sunday dinner
          <MoreHorizontal size={16} />
        </div>
        <div className="preview-still-task">
          <span className="preview-eyebrow">YOUR NEXT SMALL STEP</span>
          <h4>
            Write a few ideas
            <br />
            for Sunday dinner
          </h4>
          <span className="preview-muted-caption">
            That’s all you need to do right now.
          </span>
          <div className="preview-progress-line">
            <i />
          </div>
          <span className="preview-step-caption">
            A small step is still a step.
          </span>
        </div>
        <div className="preview-primary-action">
          <Check size={15} />I did it
        </div>
        <div className="preview-secondary-action">
          <Split size={13} />
          Take a bite
        </div>
      </div>
      <PhoneNav />
    </div>
  );
}

function EmberPreview() {
  return (
    <div className="preview-phone preview-ember">
      <PhoneStatus />
      <div className="preview-screen-content">
        <div className="preview-app-header">
          <span className="preview-mini-brand">
            <ElephantMark />
            elephant
          </span>
          <span className="preview-ember-avatar">L</span>
        </div>
        <div className="preview-ember-greeting">
          <span className="preview-eyebrow">LET’S MAKE A LITTLE PROGRESS</span>
          <h3>
            You’ve got
            <br />
            this, little by little.
          </h3>
          <Sun className="preview-ember-sun" size={46} strokeWidth={1.3} />
        </div>
        <div className="preview-ember-task">
          <span className="preview-ember-chip">
            <FolderOpen size={11} />
            Sunday dinner
          </span>
          <h4>
            Write a few ideas
            <br />
            for Sunday dinner
          </h4>
          <span className="preview-muted-caption">
            One small thing. A lovely start.
          </span>
          <span className="preview-ember-flower">✳</span>
        </div>
        <div className="preview-primary-action">
          Done & feeling good
          <Check size={15} />
        </div>
        <div className="preview-secondary-action">
          <Split size={13} />
          Take a bite
        </div>
        <div className="preview-ember-note">
          <span>♡</span>Small counts. It always has.
        </div>
      </div>
      <PhoneNav focusLabel="Today" />
    </div>
  );
}

function OrbitPreview() {
  return (
    <div className="preview-phone preview-orbit">
      <PhoneStatus />
      <div className="preview-screen-content">
        <div className="preview-app-header">
          <span className="preview-mini-brand">
            <ElephantMark />
            elephant
          </span>
          <Sparkles size={16} />
        </div>
        <div className="preview-orbit-heading">
          <span className="preview-eyebrow">LESS NOISE. MORE SPACE.</span>
          <h3>Your focus, now.</h3>
        </div>
        <div className="preview-orbit-focus">
          <span className="preview-orbit-star preview-star-one">✦</span>
          <span className="preview-orbit-star preview-star-two">+</span>
          <div className="preview-orbit-ring">
            <span className="preview-orbit-dot" />
            <div className="preview-orbit-center">
              <span className="preview-eyebrow">ONE SMALL STEP</span>
              <h4>
                Write a few ideas
                <br />
                for Sunday
                <br />
                dinner
              </h4>
              <span className="preview-orbit-project">
                <Circle size={8} />
                Sunday dinner
              </span>
            </div>
          </div>
          <span className="preview-orbit-star preview-star-three">✧</span>
        </div>
        <div className="preview-primary-action">
          <Check size={15} />
          Step complete
        </div>
        <div className="preview-secondary-action">
          <Split size={13} />
          Take a bite
        </div>
      </div>
      <PhoneNav />
    </div>
  );
}

function TidePreview() {
  return (
    <div className="preview-phone preview-tide">
      <PhoneStatus />
      <div className="preview-screen-content">
        <div className="preview-app-header">
          <span className="preview-mini-brand">
            <ElephantMark />
            elephant
          </span>
          <span className="preview-round-icon">
            <Plus size={15} />
          </span>
        </div>
        <div className="preview-tide-heading">
          <span className="preview-eyebrow">A CLEARER KIND OF DAY</span>
          <h3>Room to focus.</h3>
          <p>A little less on your mind.</p>
        </div>
        <div className="preview-tide-project">
          <span className="preview-tide-project-icon">
            <FolderOpen size={15} />
          </span>
          <span>
            Plan a Sunday dinner<small>Active project</small>
          </span>
          <ChevronLeft size={14} />
        </div>
        <div className="preview-tide-task">
          <div className="preview-tide-task-header">
            <span className="preview-eyebrow">NEXT UP</span>
            <span className="preview-tide-pill">One small step</span>
          </div>
          <h4>
            Write a few ideas
            <br />
            for Sunday dinner
          </h4>
          <div className="preview-tide-rule" />
          <span className="preview-muted-caption">
            <Leaf size={12} />
            You only need to start here.
          </span>
        </div>
        <div className="preview-primary-action">
          <Check size={15} />
          Mark complete
        </div>
        <div className="preview-secondary-action">
          <Split size={13} />
          Take a bite
        </div>
      </div>
      <PhoneNav />
    </div>
  );
}

function PopPreview() {
  return (
    <div className="preview-phone preview-pop">
      <PhoneStatus />
      <div className="preview-screen-content">
        <div className="preview-app-header">
          <span className="preview-mini-brand">
            <ElephantMark />
            elephant.
          </span>
          <span className="preview-pop-plus">
            <Plus size={17} />
          </span>
        </div>
        <div className="preview-pop-heading">
          <span className="preview-eyebrow">BIG PLANS. SMALL BITES.</span>
          <h3>
            LET’S
            <br />
            DO A THING<span>↗</span>
          </h3>
        </div>
        <div className="preview-pop-task">
          <span className="preview-pop-label">YOUR NEXT MOVE</span>
          <h4>
            Write a few
            <br />
            ideas for
            <br />
            Sunday dinner.
          </h4>
          <span className="preview-pop-project">
            <FolderOpen size={11} />
            SUNDAY DINNER
          </span>
          <span className="preview-pop-spark">✳</span>
        </div>
        <div className="preview-primary-action">
          NAILED IT.
          <Check size={17} />
        </div>
        <div className="preview-secondary-action">
          <Split size={13} />
          Take a bite
        </div>
      </div>
      <PhoneNav />
    </div>
  );
}

const previews = {
  still: StillPreview,
  ember: EmberPreview,
  orbit: OrbitPreview,
  tide: TidePreview,
  pop: PopPreview,
};

export default function DesignGallery({
  onSelect,
}: {
  onSelect: (design: DesignId) => void;
}) {
  return (
    <main className="gallery-page">
      <header className="gallery-header">
        <a
          className="gallery-brand"
          href="#"
          aria-label="Elephant design collection"
        >
          <ElephantMark />
          <span>
            elephant<span className="gallery-brand-period">.</span>
          </span>
        </a>
        <span className="gallery-header-note">A little less overwhelm.</span>
        <span className="gallery-edition">
          DESIGN COLLECTION <span>01 — 05</span>
        </span>
      </header>
      <section className="gallery-hero" aria-labelledby="gallery-title">
        <div className="gallery-hero-copy">
          <div className="gallery-kicker">
            <span /> BIG THINGS START SMALL
          </div>
          <h1 id="gallery-title">
            Small steps.
            <br />
            <span>Five fresh perspectives.</span>
          </h1>
          <p>
            One thoughtful app. Five ways to feel at home.
            <br className="gallery-desktop-break" /> Find your space to turn the
            overwhelming into the doable.
          </p>
        </div>
        <div className="gallery-hero-aside">
          <div className="gallery-hero-stamp" aria-hidden="true">
            <svg viewBox="0 0 108 108">
              <defs>
                <path
                  id="gallery-stamp-circle"
                  d="M54,54 m-42,0 a42,42 0 1,1 84,0 a42,42 0 1,1 -84,0"
                />
              </defs>
              <text>
                <textPath href="#gallery-stamp-circle">
                  ONE SMALL STEP AT A TIME · ONE SMALL STEP AT A TIME ·{" "}
                </textPath>
              </text>
            </svg>
            <ElephantMark />
          </div>
          <span className="gallery-mobile-pill">
            <span className="gallery-mobile-icon" />
            DESIGNED FOR YOUR EVERYDAY
          </span>
        </div>
      </section>
      <section
        className="gallery-collection"
        aria-label="Five mobile-first design concepts"
      >
        <div className="gallery-section-heading">
          <div>
            <span className="gallery-section-number">THE COLLECTION</span>
            <span className="gallery-section-helper">
              Same purpose. A different feeling.
            </span>
          </div>
          <span className="gallery-explore-hint">
            Pick a perspective <ArrowDown size={14} />
          </span>
        </div>
        <div className="gallery-grid">
          {concepts.map((concept) => {
            const Preview = previews[concept.id];
            return (
              <button
                type="button"
                className={`gallery-card gallery-card-${concept.id}`}
                key={concept.id}
                onClick={() => onSelect(concept.id)}
                aria-label={`Explore ${concept.name}. ${concept.description}`}
              >
                <div
                  className={`gallery-preview-stage gallery-stage-${concept.id}`}
                >
                  <span className="gallery-stage-caption">
                    {concept.character}
                  </span>
                  <div className="gallery-stage-art" aria-hidden="true" />
                  <div className="gallery-phone-wrap" aria-hidden="true">
                    <Preview />
                  </div>
                  <span className="gallery-stage-open">
                    <ArrowUpRight size={18} />
                  </span>
                  {concept.id === "still" && (
                    <span className="gallery-recommended">
                      <span />A NATURAL START
                    </span>
                  )}
                </div>
                <div className="gallery-card-info">
                  <div className="gallery-card-title">
                    <span className="gallery-concept-number">
                      {concept.number}
                    </span>
                    <h2>{concept.name}</h2>
                    <span className="gallery-swatches" aria-hidden="true">
                      {concept.colors.map((color) => (
                        <i key={color} style={{ backgroundColor: color }} />
                      ))}
                    </span>
                  </div>
                  <p>{concept.description}</p>
                  <span className="gallery-card-link">
                    Explore this direction
                    <ArrowRight size={16} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>
      <section className="gallery-bottom-note">
        <div className="gallery-bottom-mark">
          <ElephantMark />
        </div>
        <div>
          <h2>Whichever way you go, one thing at a time.</h2>
          <p>
            Every direction includes your focus, projects, completed steps, and
            settings.
            <br className="gallery-desktop-break" /> Feeling stuck? “Take a
            bite” turns the next step into something smaller.
          </p>
        </div>
        <span className="gallery-bottom-tag">
          MADE FOR SMALL SCREENS.
          <br />
          AND BIG PLANS.
        </span>
      </section>
      <footer className="gallery-footer">
        <span>Elephant — a little progress, every day.</span>
        <span>FIVE DIRECTIONS. YOUR OWN PACE.</span>
      </footer>
    </main>
  );
}
