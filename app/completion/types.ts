export interface LiveryInfo {
  name: string;
  css: string;
}

export interface Vehicle {
  "bt-id"?: string | number;
  bustimes_id?: number;
  bustimes_slug?: string;
  unit_number: string;
  reg: string;
  previous_reg?: string;
  vehicle_type: string;
  branding?: string;
  withdrawn: boolean;
  ridden: boolean;
  times_ridden: number;
  livery?: {
    current_bustimes_livery?: LiveryInfo;
    previous_bustimes_livery?: LiveryInfo;
  };
}

export interface OperatorStats {
  uniqueVehiclesRidden: number;
  totalVehicles: number;
}

export interface TabProps {
  operatorCode: string;
  operatorSlug: string;
  stats?: OperatorStats;
}