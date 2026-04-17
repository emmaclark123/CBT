
export type TransportMode = 'bus' | 'metro' | 'walking' | 'ferry';

export interface Station {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface Leg {
  fromId: string;
  toId: string;
  mode: TransportMode;
}

export interface Plan {
  id: string;
  name: string;
  stations: Station[];
  legs: Leg[];
}
