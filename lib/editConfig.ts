// lib/editConfig.ts

export interface TableConfig {
  label: string;
  fields: string[];
  displayField: string; // Used to show a friendly identifier in the UI
  relations?: Record<string, {
    queryPath: string;  // Explicit string mapping to the target Convex query file
    labelField: string; // The property string to pull descriptive options from
  }>;
}

export const editConfig: Record<string, TableConfig> = {
  stops: {
    label: "Stops",
    displayField: 'commonName',
    fields: ['commonName', 'indicator', 'active', 'hidden', 'stopTypeId'],
    relations: {
      stopTypeId: { queryPath: 'functions.admin.getAllStopTypes', labelField: 'name' }
    }
  },
  units: {
    label: "Units",
    displayField: 'unit_number',
    fields: ['unit_number', 'unit_reg', 'type_id', 'operator_id', 'livery_id'],
    relations: {
      type_id: { queryPath: 'functions.admin.getAllTypes', labelField: 'type_name' },
      operator_id: { queryPath: 'functions.admin.getAllOperators', labelField: 'display_name' },
      livery_id: { queryPath: 'functions.admin.getAllLiveries', labelField: 'livery_name' }
    }
  },
  operators: {
    label: "Operators",
    fields: ["display_name"],
    displayField: "display_name",
  },
};

export type EditableTable = keyof typeof editConfig;