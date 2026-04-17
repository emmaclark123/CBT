export const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export const getEstimateTime = (distance: number, mode: string): number => {
  // Average speeds in km/h
  const speeds: Record<string, number> = {
    bus: 35,
    metro: 45,
    walk: 5,
    ferry: 20
  };
  const speed = speeds[mode] || 30;
  return (distance / speed) * 60; // returns minutes
};

export const formatTime = (minutes: number): string => {
  if (minutes < 60) return `${Math.round(minutes)}分钟`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}小时${mins}分钟`;
};
