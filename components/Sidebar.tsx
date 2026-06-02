"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser, useClerk, SignOutButton, Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { createRoot, type Root } from "react-dom/client";
import { api } from "@/convex/_generated/api";
import { useTheme } from "@/components/ThemeProvider";
import { 
  FileText, Home, User, Users, CheckCircle, Palette, RefreshCw, Edit, Scale,
  Shield, Sun, LogOut, Menu, X, ChevronLeft, ChevronRight, ChartArea, Settings
} from "lucide-react";

const navLinks = [
  { name: "Home", href: "/", icon: Home },
  { name: "Profile", href: "/profile", icon: User },
  { name: "Friends", href: "/friends", icon: Users },
  { name: "Completion", href: "/completion", icon: CheckCircle },
  { name: "Stats", href: "/stats", icon: ChartArea },
  { name: "Liveries", href: "/liveries", icon: Palette },
  { name: "Update", href: "/update", icon: RefreshCw },
  { name: "Request Edit", href: "/request-edit", icon: Edit },
];

const bustimesSourceFeatures = [
  { key: "vehicleSearch", label: "Vehicle search" },
  { key: "fleet", label: "Fleet lists" },
  { key: "routes", label: "Route lists" },
  { key: "departures", label: "Bus departures" },
  { key: "tripLookup", label: "Trip logging" },
  { key: "routeInfo", label: "Route details" },
  { key: "liveVehicles", label: "Live bus map" },
] as const;

type BustimesSourceFeature = (typeof bustimesSourceFeatures)[number]["key"];

type BustimesSourceSettings = {
  bustimesBaseUrl: string;
  bustimesEnabledFeatures: string[];
};

function SettingsPage({
  settings,
  onSave,
}: {
  settings: BustimesSourceSettings | undefined;
  onSave: (nextSettings: {
    bustimesBaseUrl: string;
    bustimesEnabledFeatures: BustimesSourceFeature[];
  }) => Promise<void>;
}) {
  const [baseUrl, setBaseUrl] = useState(settings?.bustimesBaseUrl ?? "https://bustimes.org");
  const [enabledFeatures, setEnabledFeatures] = useState<BustimesSourceFeature[]>(
    (settings?.bustimesEnabledFeatures ?? []).filter((feature): feature is BustimesSourceFeature =>
      bustimesSourceFeatures.some((option) => option.key === feature),
    ),
  );
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!settings) return;

    setBaseUrl(settings.bustimesBaseUrl);
    setEnabledFeatures(
      settings.bustimesEnabledFeatures.filter((feature): feature is BustimesSourceFeature =>
        bustimesSourceFeatures.some((option) => option.key === feature),
      ),
    );
  }, [settings]);

  function toggleFeature(feature: BustimesSourceFeature) {
    setStatus("idle");
    setEnabledFeatures((current) =>
      current.includes(feature)
        ? current.filter((item) => item !== feature)
        : [...current, feature],
    );
  }

  async function handleSave() {
    try {
      setStatus("saving");
      setErrorMessage("");
      await onSave({
        bustimesBaseUrl: baseUrl,
        bustimesEnabledFeatures: enabledFeatures,
      });
      setStatus("saved");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Settings could not be saved.");
    }
  }

  const inputClass =
    "mt-2 w-full rounded-md border border-ts-border bg-ts-surface px-3 py-2 text-sm text-ts-text-1 outline-none focus:border-ts-accent";

  return (
    <div className="px-4 py-2">
      <p className="text-sm font-semibold text-ts-text-1">Settings</p>
      <p className="mt-1 text-xs text-ts-text-3">Configure your custom preferences here.</p>

      <div className="mt-5 max-w-xl">
        <label className="block text-xs font-semibold text-ts-text-2">
          Bus data source
          <input
            value={baseUrl}
            onChange={(event) => {
              setStatus("idle");
              setBaseUrl(event.target.value);
            }}
            placeholder="https://bustimes.org"
            className={inputClass}
          />
        </label>
        <p className="mt-2 text-xs text-ts-text-3">
          Use a Bustimes-compatible base URL. Leave it as bustimes.org for the default source.
        </p>

        <div className="mt-5">
          <p className="text-xs font-semibold text-ts-text-2">Apply custom source to</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {bustimesSourceFeatures.map((feature) => (
              <label
                key={feature.key}
                className="flex items-center gap-2 rounded-md border border-ts-border px-3 py-2 text-xs font-medium text-ts-text-2"
              >
                <input
                  type="checkbox"
                  checked={enabledFeatures.includes(feature.key)}
                  onChange={() => toggleFeature(feature.key)}
                  className="h-4 w-4 accent-ts-accent"
                />
                {feature.label}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!settings || status === "saving"}
            className="rounded-md bg-ts-accent px-4 py-2 text-xs font-semibold text-ts-text-inv disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "saving" ? "Saving..." : "Save settings"}
          </button>
          {status === "saved" && <span className="text-xs text-ts-accent">Saved</span>}
          {status === "error" && <span className="text-xs text-ts-danger">{errorMessage}</span>}
          {!settings && <span className="text-xs text-ts-text-3">Loading...</span>}
        </div>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const { user, isLoaded } = useUser();
  const isStaff = isLoaded && user?.publicMetadata?.is_staff === "true";
  const { openUserProfile } = useClerk();
  const { theme, setTheme } = useTheme();

  // State
  const [isCollapsed, setIsCollapsed] = useState(false); // For Desktop
  const [mobileOpenPath, setMobileOpenPath] = useState<string | null>(null); // For Mobile
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFormat, setImportFormat] = useState<"csv" | "json">("csv");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logTrip = useMutation(api.functions.trips.logTrip);
  const bustimesSourceSettings = useQuery(api.functions.userSettings.getMyBustimesSource);
  const saveBustimesSourceSettings = useMutation(api.functions.userSettings.saveMyBustimesSource);
  const isMobileOpen = mobileOpenPath === pathname;
  const tripLogsPageRootRef = useRef<Root | null>(null);
  const settingsPageRootRef = useRef<Root | null>(null);

  const themeOptions = [
    { key: "bright" as const, label: "Bright", icon: Sun },
    { key: "light" as const, label: "Light", icon: Palette },
    { key: "dark" as const, label: "Dark", icon: Sun },
  ];

  async function handleExport(format: "csv" | "json") {
    try {
      setIsExporting(true);
      const dateTag = new Date().toISOString().split("T")[0];

      const response = await fetch(`/api/trip-logs/export?format=${format}`);
      if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `trip-logs-${dateTag}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Export failed.";
      alert(message || "Export failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
  }

  function handleImportClick(format: "csv" | "json") {
    setImportFormat(format);
    fileInputRef.current?.click();
  }

  function mountTripLogsPage(container: HTMLDivElement) {
    if (!tripLogsPageRootRef.current) {
      tripLogsPageRootRef.current = createRoot(container);
    }

    tripLogsPageRootRef.current.render(
      <div className="px-4 py-2">
        <p className="text-sm font-semibold text-ts-text-1">Trip logs</p>
        <p className="mt-1 text-xs text-ts-text-3">Export or import your trips as CSV or JSON.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              if (!isExporting) void handleExport("csv");
            }}
            className="rounded-2xl border border-ts-border px-3 py-2 text-xs font-semibold text-ts-text-2"
          >
            {isExporting ? "Exporting..." : "Export CSV"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!isImporting) handleImportClick("csv");
            }}
            className="rounded-2xl border border-ts-border px-3 py-2 text-xs font-semibold text-ts-text-2"
          >
            {isImporting ? "Importing..." : "Import CSV"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!isExporting) void handleExport("json");
            }}
            className="rounded-2xl border border-ts-border px-3 py-2 text-xs font-semibold text-ts-text-2"
          >
            {isExporting ? "Exporting..." : "Export JSON"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!isImporting) handleImportClick("json");
            }}
            className="rounded-2xl border border-ts-border px-3 py-2 text-xs font-semibold text-ts-text-2"
          >
            {isImporting ? "Importing..." : "Import JSON"}
          </button>
        </div>
      </div>
    );
  }

  function unmountTripLogsPage() {
    tripLogsPageRootRef.current?.unmount();
    tripLogsPageRootRef.current = null;
  }

  function mountTripLogsIcon(container: HTMLDivElement) {
    const root = createRoot(container);
    root.render(<FileText size={16} />);
  }

  function unmountTripLogsIcon(container?: HTMLDivElement) {
    if (container) {
      createRoot(container).unmount();
    }
  }

  // Settings custom sub-page setup
  function renderSettingsPage() {
    settingsPageRootRef.current?.render(
      <SettingsPage
        settings={bustimesSourceSettings}
        onSave={async (nextSettings) => {
          await saveBustimesSourceSettings(nextSettings);
        }}
      />
    );
  }

  function mountSettingsPage(container: HTMLDivElement) {
    if (!settingsPageRootRef.current) {
      settingsPageRootRef.current = createRoot(container);
    }
    renderSettingsPage();
  }

  function unmountSettingsPage() {
    settingsPageRootRef.current?.unmount();
    settingsPageRootRef.current = null;
  }

  function mountSettingsIcon(container: HTMLDivElement) {
    const root = createRoot(container);
    root.render(<Settings size={16} />);
  }

  function unmountSettingsIcon(container?: HTMLDivElement) {
    if (container) {
      createRoot(container).unmount();
    }
  }

  useEffect(() => {
    renderSettingsPage();
  }, [bustimesSourceSettings, saveBustimesSourceSettings]);

  const tripLogsCustomPage = {
    label: "Trip logs",
    url: "trip-logs",
    mount: mountTripLogsPage,
    unmount: unmountTripLogsPage,
    mountIcon: mountTripLogsIcon,
    unmountIcon: unmountTripLogsIcon,
  };

  const settingsCustomPage = {
    label: "Settings",
    url: "settings",
    mount: mountSettingsPage,
    unmount: unmountSettingsPage,
    mountIcon: mountSettingsIcon,
    unmountIcon: unmountSettingsIcon,
  };

  const userProfileProps = {
    customPages: [tripLogsCustomPage, settingsCustomPage],
  };

  function parseCsv(text: string) {
    const rows: string[][] = [];
    let current = "";
    let row: string[] = [];
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === "," && !inQuotes) {
        row.push(current);
        current = "";
        continue;
      }

      if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(current);
        if (row.some((value) => value.trim() !== "")) rows.push(row);
        row = [];
        current = "";
        continue;
      }

      current += char;
    }

    row.push(current);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    return rows;
  }

  function parseNumber(value: string | undefined) {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  function parseJson(value: string | undefined) {
    if (!value) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  function parseTransportType(value: string | undefined) {
    switch (value) {
      case "Rail":
      case "Bus":
      case "Tram":
      case "Ferry":
      case "Taxi":
      case "Other":
        return value;
      default:
        return "Other";
    }
  }

  function normalizeServiceDate(value: string | undefined) {
    if (!value) return undefined;
    const asNumber = parseNumber(value);
    if (asNumber) return asNumber;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  async function handleImportChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setIsImporting(true);
      const text = await file.text();
      const fileName = file.name.toLowerCase();
      const format = fileName.endsWith(".json") ? "json" : importFormat;

      let imported = 0;
      if (format === "json") {
        const records = JSON.parse(text);
        if (!Array.isArray(records)) throw new Error("JSON must be an array of trips.");
        for (const record of records) {
          const serviceDate = normalizeServiceDate(String(record?.service_date ?? ""));
          if (!serviceDate) continue;
          await logTrip({
            service_number: record.service_number || "Unknown",
            operator: record.operator || "Unknown",
            operator_slug: record.operator_slug || "unknown",
            service_date: serviceDate,
            transport_type: record.transport_type || "Other",
            bustimes_service_id: parseNumber(String(record.bustimes_service_id ?? "")),
            bustimes_service_slug: record.bustimes_service_slug || undefined,
            origin_name: record.origin_name || "Unknown",
            origin_stop_code: record.origin_stop_code || "",
            destination_name: record.destination_name || "Unknown",
            destination_stop_code: record.destination_stop_code || "",
            scheduled_departure: record.scheduled_departure || "",
            actual_departure: record.actual_departure || undefined,
            scheduled_arrival: record.scheduled_arrival || "",
            actual_arrival: record.actual_arrival || undefined,
            full_route: record.full_route ?? null,
            ridden_route: record.ridden_route ?? null,
            units: record.units ?? [],
            notes: record.notes || undefined,
          });
          imported += 1;
        }
        alert(`Import complete. Added ${imported} trips.`);
        return;
      }

      const rows = parseCsv(text);
      if (rows.length < 2) throw new Error("CSV is empty.");

      const headers = rows[0].map((value) => value.trim());
      const required = [
        "service_number",
        "operator",
        "operator_slug",
        "service_date",
        "transport_type",
        "origin_name",
        "origin_stop_code",
        "destination_name",
        "destination_stop_code",
        "scheduled_departure",
        "scheduled_arrival",
      ];
      const missing = required.filter((column) => !headers.includes(column));
      if (missing.length > 0) {
        throw new Error(`Missing required columns: ${missing.join(", ")}`);
      }

      for (let i = 1; i < rows.length; i += 1) {
        const row = rows[i];
        const record: Record<string, string> = {};
        headers.forEach((header, index) => {
          record[header] = row[index] ?? "";
        });

        const serviceDate = normalizeServiceDate(record.service_date);
        if (!serviceDate) continue;

        await logTrip({
          service_number: record.service_number || "Unknown",
          operator: record.operator || "Unknown",
          operator_slug: record.operator_slug || "unknown",
          service_date: serviceDate,
          transport_type: parseTransportType(record.transport_type),
          bustimes_service_id: parseNumber(record.bustimes_service_id),
          bustimes_service_slug: record.bustimes_service_slug || undefined,
          origin_name: record.origin_name || "Unknown",
          origin_stop_code: record.origin_stop_code || "",
          destination_name: record.destination_name || "Unknown",
          destination_stop_code: record.destination_stop_code || "",
          scheduled_departure: record.scheduled_departure || "",
          actual_departure: record.actual_departure || undefined,
          scheduled_arrival: record.scheduled_arrival || "",
          actual_arrival: record.actual_arrival || undefined,
          full_route: parseJson(record.full_route) ?? null,
          ridden_route: parseJson(record.ridden_route) ?? null,
          units: parseJson(record.units) ?? [],
          notes: record.notes || undefined,
        });
        imported += 1;
      }
      alert(`Import complete. Added ${imported} trips.`);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Import failed.";
      alert(message || "Import failed. Please check the CSV format.");
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden" 
          onClick={() => setMobileOpenPath(null)}
        />
      )}

      {/* Sidebar Container */}
      <aside 
        className={`fixed md:relative z-50 h-full flex flex-col bg-ts-surface border-r border-ts-border-soft transition-all duration-300 ease-in-out ${
          isCollapsed ? "w-[58px]" : "w-[240px]"
        } ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* Header/Brand */}
        <div className="flex items-center justify-between p-5 border-b border-ts-border-soft flex-shrink-0 h-[72px]">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 flex-shrink-0 bg-ts-accent rounded-lg flex items-center justify-center text-ts-text-inv font-mono font-extrabold text-[16px]">
              TS
            </div>
            {!isCollapsed && <span className="text-[13px] font-bold text-ts-text-1 leading-tight whitespace-nowrap">Transport Statistics</span>}
          </div>
          
          {/* Toggle Buttons */}
          <button onClick={() => setIsCollapsed(!isCollapsed)} className="hidden md:block p-1 text-ts-text-2">
            {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
          <button onClick={() => setMobileOpenPath(null)} className="md:hidden p-1 text-ts-text-2">
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            const Icon = link.icon;
            return (
              <Link 
                key={link.name} 
                href={link.href}
                title={isCollapsed ? link.name : ""}
                className={`flex whitespace-nowrap items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-[13.5px] font-medium transition-all duration-150 border border-transparent ${
                  isActive 
                    ? "bg-ts-accent-light text-ts-accent border-ts-accent-border" 
                    : "text-ts-text-2 hover:bg-ts-surface-2 hover:border-ts-border-soft"
                }`}
              >
                <div className="w-[18px] h-[20px] flex-shrink-0 flex items-center justify-center opacity-70 whitespace-nowrap">
                  <Icon size={18} />
                </div>
                {!isCollapsed && link.name}
              </Link>
            );
          })}

          {isStaff && !isCollapsed && (
            <div className="mt-4">
              <p className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-ts-text-3 px-3 py-2">Staff</p>
              <Link href="/admin" className="flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-[13.5px] text-ts-text-2 hover:bg-ts-surface-2 transition-all">
                <Shield size={18} /> Admin
              </Link>
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="p-2 border-t border-ts-border-soft flex-shrink-0">
          <div className="mb-2 rounded-[8px] border border-ts-border-soft bg-ts-surface-2 p-1">
            <div className={`px-2 pb-1 text-[9.5px] font-bold uppercase tracking-[0.09em] text-ts-text-3 ${isCollapsed ? "text-center" : ""}`}>
              {!isCollapsed ? "Theme" : ""}
            </div>
            <div className={`grid gap-1 ${isCollapsed ? "grid-cols-1" : "grid-cols-3"}`}>
              {themeOptions.map(({ key, label, icon: Icon }) => {
                const active = theme === key;
                return (
                  <button
                    key={key}
                    type="button"
                    title={label}
                    onClick={() => setTheme(key)}
                    className={`flex items-center justify-center gap-2 rounded-[6px] px-2 py-2 text-[12px] font-semibold transition-all ${
                      active
                        ? "bg-ts-accent-light text-ts-accent border border-ts-accent-border"
                        : "text-ts-text-2 hover:bg-ts-surface border border-transparent"
                    } ${isCollapsed ? "aspect-square p-0" : ""}`}
                  >
                    <Icon size={16} />
                    {!isCollapsed && label}
                  </button>
                );
              })}
            </div>
          </div>

          <Show when="signed-in">
            <div
              onClick={() => openUserProfile(userProfileProps)}
              className={`flex items-center gap-2.5 p-2 rounded-[6px] bg-ts-surface-2 border border-ts-border-soft cursor-pointer hover:border-ts-accent-border transition-all ${isCollapsed ? "justify-center" : ""}`}
            >
              <div className="pointer-events-none h-7 w-7 flex-shrink-0">
                <UserButton />
              </div>
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-ts-text-1 truncate">{user?.fullName || "User"}</p>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="text/csv,application/json,.csv,.json"
              className="hidden"
              onChange={handleImportChange}
            />
            <SignOutButton>
              <button className={`flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-[13px] text-red-400 hover:bg-red-950/20 hover:text-red-300 w-full transition-all whitespace-nowrap ${isCollapsed ? "justify-center" : ""}`}>
                <LogOut size={18} />
                {!isCollapsed && "Log out"}
              </button>
            </SignOutButton>
          </Show>

          <Show when="signed-out">
              <SignInButton>
                <button className="flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-[13px] text-ts-text-2 hover:bg-ts-surface-2 w-full transition-all whitespace-nowrap">
                  Login
                </button>
              </SignInButton>
              <SignUpButton>
                <button className="flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-[13px] text-ts-text-2 hover:bg-ts-surface-2 w-full transition-all whitespace-nowrap">
                  Register
                </button>
              </SignUpButton>
          </Show>
          <div className="mt-4">
              <Link href="/legal" className="flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-[13.5px] text-ts-text-2 hover:bg-ts-surface-2 transition-all">
                <Scale size={18} /> {!isCollapsed && "Legal, Privacy & Data"}
              </Link>
            </div>
        </div>
      </aside>

      {/* Mobile Hamburger Menu */}
      <button 
        onClick={() => setMobileOpenPath(pathname)}
        className="md:hidden fixed top-4 left-4 z-30 p-2 bg-ts-surface text-ts-text-1 rounded-md border border-ts-border-soft"
      >
        <Menu size={20} />
      </button>
    </>
  );
}
