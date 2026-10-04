export type DesignId = "still" | "ember" | "orbit" | "tide" | "pop";

export const designs: {
  id: DesignId;
  number: string;
  name: string;
  description: string;
  color: string;
}[] = [
  {
    id: "still",
    number: "01",
    name: "Still",
    description: "A little space to breathe.",
    color: "#344b3d",
  },
  {
    id: "ember",
    number: "02",
    name: "Ember",
    description: "Find your gentle momentum.",
    color: "#b95435",
  },
  {
    id: "orbit",
    number: "03",
    name: "Orbit",
    description: "Your own space to focus.",
    color: "#c4b5fa",
  },
  {
    id: "tide",
    number: "04",
    name: "Tide",
    description: "Make room for a clearer day.",
    color: "#315fbc",
  },
  {
    id: "pop",
    number: "05",
    name: "Pop",
    description: "Small steps. Big energy.",
    color: "#d9ed65",
  },
];
