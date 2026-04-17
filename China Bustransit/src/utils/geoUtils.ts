
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

export const TRANSPORT_CONFIG = {
  bus: {
    label: '公交',
    speed: 35, // km/h
    color: '#3b82f6', // blue-500
    icon: '🚌',
  },
  metro: {
    label: '地铁',
    speed: 45,
    color: '#8b5cf6', // purple-500
    icon: '🚇',
  },
  walking: {
    label: '步行',
    speed: 5,
    color: '#10b981', // green-500
    icon: '🚶',
  },
  ferry: {
    label: '轮渡',
    speed: 20,
    color: '#0ea5e9', // sky-500
    icon: '⛴️',
  },
} as const;

export function formatDuration(hours: number): string {
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${mins} 分钟`;
  }
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}
