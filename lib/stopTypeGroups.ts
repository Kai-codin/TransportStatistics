export interface StopTypeGroup {
  name: string;
  keywords: string[];
  color: string;
}

export const STOP_TYPE_GROUPS: StopTypeGroup[] = [
  { name: "rail", keywords: ["rail", "train"], color: "#b61653" },
  { name: "metro", keywords: ["metro"], color: "#eab308" },
  { name: "bus", keywords: ["bus", "coach"], color: "#3b82f6" },
  { name: "airport", keywords: ["airport"], color: "#0891b2" },
  { name: "ferry", keywords: ["ferry"], color: "#14b8a6" },
  { name: "taxi", keywords: ["taxi"], color: "#e87223" },
];

export function getGroupForType(typeName: string): StopTypeGroup | undefined {
  const name = typeName.toLowerCase();
  return STOP_TYPE_GROUPS.find((group) =>
    group.keywords.some((keyword) => name.includes(keyword))
  );
}
