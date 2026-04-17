import React, { useState, useEffect, useMemo } from 'react';
import { 
  MapContainer, 
  TileLayer, 
  Marker, 
  Popup, 
  Polyline, 
  useMap, 
  useMapEvents 
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { 
  Bus, 
  Train, 
  Navigation, 
  Ship, 
  Plus, 
  Trash2, 
  ChevronUp, 
  ChevronDown, 
  Upload, 
  X,
  Layers,
  MapPin,
  Route,
  Search as SearchIcon,
  FileDown,
  Printer,
  Image as ImageIcon
} from 'lucide-react';
import axios from 'axios';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import gcoord from 'gcoord';
import html2canvas from 'html2canvas';

// --- Types ---
type TransportMode = 'bus' | 'metro' | 'walking' | 'ferry';

interface Station {
  id: string;
  name: string;
  lat: number;
  lng: number;
  modeAfter?: TransportMode;
}

interface ReferenceLine {
  id: string;
  name: string;
  points: [number, number][]; // lat, lng (WGS-84)
  stops: { name: string, lat: number, lng: number }[]; // WGS-84
  active: boolean;
}

interface Plan {
  id: string;
  name: string;
  stations: Station[];
  visibleReferences?: string[]; // IDs of other plans to show as reference
}

interface SavedState {
  plans: Plan[];
  activePlanId: string;
  timestamp: number;
}

// --- Utils ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Coordinate conversion for Gaode Tiles (WGS-84 to GCJ-02)
const toMap = (lat: number, lng: number): [number, number] => {
  const [glng, glat] = gcoord.transform([lng, lat], gcoord.WGS84, gcoord.GCJ02);
  return [glat, glng];
};

const TRANSPORT_MODES: { mode: TransportMode; icon: React.ReactNode; color: string; speed: number; label: string; emoji: string }[] = [
  { mode: 'bus', icon: <Bus size={16} />, color: '#3b82f6', speed: 30, label: '公交', emoji: '🚌' },
  { mode: 'metro', icon: <Train size={16} />, color: '#ef4444', speed: 50, label: '地铁', emoji: '🚇' },
  { mode: 'walking', icon: <Navigation size={16} />, color: '#22c55e', speed: 5, label: '步行', emoji: '🚶' },
  { mode: 'ferry', icon: <Ship size={16} />, color: '#06b6d4', speed: 20, label: '轮渡', emoji: '⛴️' },
];

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// --- Icons ---
const getStationIcon = (index: number, total: number) => {
  let color = '#3b82f6';
  if (index === 0) color = '#22c55e';
  if (index === total - 1 && total > 1) color = '#ef4444';
  
  return L.divIcon({
    className: 'custom-station-icon',
    html: `<div style="background-color: ${color}; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); color: white; font-weight: bold; font-size: 11px;">${index + 1}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
};

const getModeIcon = (emoji: string) => {
  return L.divIcon({
    className: 'mode-marker-icon',
    html: `<div style="background-color: white; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); font-size: 14px;">${emoji}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
};

// --- Map Logic ---
function MapEvents({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      // Need to convert back to WGS84 for our internal data? 
      // Actually, since we work in WGS-84 but display in GCJ-02, 
      // the click event returns GCJ-02 coords from the map.
      const [wlng, wlat] = gcoord.transform([e.latlng.lng, e.latlng.lat], gcoord.GCJ02, gcoord.WGS84);
      onMapClick(wlat, wlng);
    },
  });
  return null;
}

function MapUpdater({ center, zoom }: { center: [number, number] | null, zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, zoom || 13);
    }
  }, [center, map, zoom]);
  return null;
}

// --- App ---
export default function App() {
  const [plans, setPlans] = useState<Plan[]>(() => {
    const saved = localStorage.getItem('trip-plans-v3');
    return saved ? JSON.parse(saved) : [{ id: '1', name: '规划 1', stations: [], visibleReferences: [] }];
  });
  const [activePlanId, setActivePlanId] = useState<string>(plans[0]?.id || '1');
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  
  const [history, setHistory] = useState<SavedState[]>(() => {
    const saved = localStorage.getItem('trip-history-v3');
    return saved ? JSON.parse(saved) : [];
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [referenceLines, setReferenceLines] = useState<ReferenceLine[]>([]);
  const [isSearchingLines, setIsSearchingLines] = useState(false);

  const activePlan = plans.find(p => p.id === activePlanId) || plans[0];

  useEffect(() => {
    localStorage.setItem('trip-plans-v3', JSON.stringify(plans));
    localStorage.setItem('trip-history-v3', JSON.stringify(history));
  }, [plans, history]);

  // Actions
  const saveState = () => {
    const newState: SavedState = { plans, activePlanId, timestamp: Date.now() };
    const newHistory = [newState, ...history].slice(0, 5);
    setHistory(newHistory);
    alert('规划已保存！');
  };

  const rollback = (state: SavedState) => {
    setPlans(state.plans);
    setActivePlanId(state.activePlanId);
    alert(`已回滚到 ${new Date(state.timestamp).toLocaleString()}`);
  };

  const addStation = (name: string, lat: number, lng: number) => {
    const newStation: Station = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      lat,
      lng,
      modeAfter: 'bus'
    };
    setPlans(prev => prev.map(p => 
      p.id === activePlanId ? { ...p, stations: [...p.stations, newStation] } : p
    ));
  };

  const removeStation = (id: string) => {
    setPlans(prev => prev.map(p => 
      p.id === activePlanId ? { ...p, stations: p.stations.filter(s => s.id !== id) } : p
    ));
  };

  const updateStationName = (id: string, name: string) => {
    setPlans(prev => prev.map(p => 
      p.id === activePlanId ? { ...p, stations: p.stations.map(s => s.id === id ? { ...s, name } : s) } : p
    ));
  };

  const updateStationMode = (id: string, mode: TransportMode) => {
    setPlans(prev => prev.map(p => 
      p.id === activePlanId ? { ...p, stations: p.stations.map(s => s.id === id ? { ...s, modeAfter: mode } : s) } : p
    ));
  };

  const moveStation = (id: string, dir: 'up' | 'down') => {
    setPlans(prev => prev.map(p => {
      if (p.id !== activePlanId) return p;
      const idx = p.stations.findIndex(s => s.id === id);
      if (idx === -1) return p;
      const newSt = [...p.stations];
      const targetIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= newSt.length) return p;
      [newSt[idx], newSt[targetIdx]] = [newSt[targetIdx], newSt[idx]];
      return { ...p, stations: newSt };
    }));
  };

  // Coordinate and Location Search
  const handleSearch = async (query: string = searchQuery) => {
    if (!query.trim()) return;
    setIsSearching(true);

    // 1. Check for coordinates
    const coordRegex = /(-?\d+\.?\d*)\s*[NnSs]?,\s*(-?\d+\.?\d*)\s*[EeWw]?/;
    const match = query.match(coordRegex);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      if (!isNaN(lat) && !isNaN(lng)) {
        const mapCoord = toMap(lat, lng);
        setMapCenter(mapCoord);
        addStation(`坐标点 ${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng);
        setSearchQuery('');
        setIsSearching(false);
        return;
      }
    }

    // 2. Search for Place
    try {
      const params: any = { q: query, format: 'json', addressdetails: 1, limit: 10, countrycodes: 'cn' };
      
      // Context bias: If we have a previous station, search nearby
      if (activePlan.stations.length > 0) {
        const last = activePlan.stations[activePlan.stations.length - 1];
        // viewbox=<x1>,<y1>,<x2>,<y2> (left,top,right,bottom)
        const radius = 0.5; // About 50km
        params.viewbox = `${last.lng - radius},${last.lat + radius},${last.lng + radius},${last.lat - radius}`;
        params.bounded = 1; // Prioritize results in this viewbox
      }

      const res = await axios.get(`https://nominatim.openstreetmap.org/search`, { params });
      setSearchResults(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  // Bus Line Search using Overpass
  const searchBusLine = async (lineName: string) => {
    setIsSearchingLines(true);
    try {
      const query = `[out:json][timeout:25];
        (
          relation["type"="route"]["route"="bus"]["name"~"${lineName}"](18.0,73.0,54.0,135.0);
          relation["type"="route"]["route"="bus"]["ref"~"${lineName}"](18.0,73.0,54.0,135.0);
        );
        out body; >; out skel qt;`;
      
      const res = await axios.post('https://overpass-api.de/api/interpreter', query);
      const data = res.data;
      
      if (data.elements) {
        const relations = data.elements.filter((e: any) => e.type === 'relation');
        const ways = data.elements.filter((e: any) => e.type === 'way');
        const nodes = data.elements.filter((e: any) => e.type === 'node');

        const newLines: ReferenceLine[] = relations.map((rel: any) => {
          const points: [number, number][] = [];
          const stops: { name: string, lat: number, lng: number }[] = [];
          
          rel.members.forEach((m: any) => {
            if (m.type === 'way') {
              const way = ways.find((w: any) => w.id === m.ref);
              if (way) way.nodes.forEach((nid: any) => {
                const node = nodes.find((n: any) => n.id === nid);
                if (node) points.push([node.lat, node.lon]);
              });
            } else if (m.type === 'node' && (m.role?.includes('stop') || m.role?.includes('platform'))) {
              const node = nodes.find((n: any) => n.id === m.ref);
              if (node) stops.push({ name: node.tags?.name || node.tags?.name_zh || '站', lat: node.lat, lng: node.lon });
            }
          });

          return { id: rel.id.toString(), name: rel.tags.name || rel.tags.ref || lineName, points, stops, active: true };
        }).filter((l: any) => l.points.length > 0);

        setReferenceLines(prev => [...prev, ...newLines.slice(0, 5)]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearchingLines(false);
    }
  };

  // Calculation
  const stats = useMemo(() => {
    let dist = 0;
    let time = 0;
    const legs: { d: number, t: number }[] = [];

    for (let i = 0; i < activePlan.stations.length - 1; i++) {
      const s1 = activePlan.stations[i];
      const s2 = activePlan.stations[i+1];
      const d = calculateDistance(s1.lat, s1.lng, s2.lat, s2.lng);
      const mode = TRANSPORT_MODES.find(m => m.mode === s1.modeAfter) || TRANSPORT_MODES[0];
      const t = (d / mode.speed) * 60;
      dist += d;
      time += t;
      legs.push({ d, t });
    }
    return { dist, time, legs };
  }, [activePlan.stations]);

  const exportAsImage = async () => {
    const element = document.body;
    const canvas = await html2canvas(element, {
      useCORS: true,
      ignoreElements: (el) => el.classList.contains('no-export')
    });
    const link = document.createElement('a');
    link.download = `${activePlan.name}.png`;
    link.href = canvas.toDataURL();
    link.click();
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 overflow-hidden text-slate-900 font-sans">
      {/* Sidebar */}
      <div className="w-96 h-full flex flex-col bg-white border-r border-slate-200 shadow-2xl z-[1000]">
        {/* Header & Plan Tabs */}
        <div className="p-4 bg-slate-900 text-white space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-black flex items-center gap-2 tracking-tighter italic">
              <Route className="text-blue-400" /> CHINA TRANSIT
            </h1>
            <div className="flex gap-2">
              <button 
                onClick={saveState}
                title="保存当前规划"
                className="p-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg transition-all text-blue-300"
              >
                <FileDown size={18} />
              </button>
              <button 
                onClick={() => {
                  const id = Math.random().toString(36).substr(2, 9);
                  const nextNum = plans.length + 1;
                  setPlans([...plans, { id, name: `规划 ${nextNum}`, stations: [], visibleReferences: [] }]);
                  setActivePlanId(id);
                }}
                className="p-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg transition-all shadow-lg shadow-blue-900/40"
              >
                <Plus size={18} />
              </button>
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar scroll-smooth">
            {plans.map(p => (
              <div 
                key={p.id}
                onClick={() => setActivePlanId(p.id)}
                onDoubleClick={() => setEditingPlanId(p.id)}
                className={cn(
                  "px-4 py-2 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap transition-all flex items-center gap-2 border-2",
                  activePlanId === p.id 
                    ? "bg-blue-600 border-blue-400 text-white shadow-lg" 
                    : "bg-slate-800 border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-700"
                )}
              >
                {editingPlanId === p.id ? (
                  <input
                    autoFocus
                    className="bg-transparent outline-none w-16"
                    defaultValue={p.name}
                    onBlur={(e) => {
                      setPlans(prev => prev.map(pl => pl.id === p.id ? { ...pl, name: e.target.value } : pl));
                      setEditingPlanId(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  />
                ) : (
                  <span>{p.name}</span>
                )}
                {plans.length > 1 && (
                  <button onClick={(e) => {
                    e.stopPropagation();
                    const next = plans.filter(pl => pl.id !== p.id);
                    setPlans(next);
                    if (activePlanId === p.id) setActivePlanId(next[0].id);
                  }}>
                    <X size={12} className="opacity-40 hover:opacity-100" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {history.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              {history.map((h, i) => (
                <button 
                  key={i}
                  onClick={() => rollback(h)}
                  className="px-3 py-1 bg-slate-800 rounded-full text-[9px] font-bold text-slate-500 hover:bg-slate-700 hover:text-slate-300 transition-all border border-slate-700"
                >
                  回档 {i + 1}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="p-4 border-b border-slate-100 bg-white sticky top-0">
          <div className="relative">
            <SearchIcon className={cn("absolute left-3 top-2.5 transition-colors", isSearching ? "text-blue-500 animate-pulse" : "text-slate-400")} size={18} />
            <input 
              type="text" 
              placeholder="搜索地名、线路或 32.9, 115.8"
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm border border-slate-200"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          
          {searchResults.length > 0 && (
            <div className="mt-2 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 origin-top">
              {searchResults.map((res, i) => (
                <div 
                  key={i} 
                  className="px-4 py-3 hover:bg-blue-50 cursor-pointer text-sm border-b last:border-0 border-slate-50"
                  onClick={() => {
                    const lat = parseFloat(res.lat);
                    const lon = parseFloat(res.lon);
                    setMapCenter(toMap(lat, lon));
                    addStation(res.display_name.split(',')[0], lat, lon);
                    setSearchResults([]);
                    setSearchQuery('');
                  }}
                >
                  <div className="font-bold truncate text-slate-800">{res.display_name.split(',')[0]}</div>
                  <div className="text-[10px] text-slate-400 truncate mt-0.5">{res.display_name}</div>
                </div>
              ))}
              <div 
                className="px-4 py-2.5 bg-blue-600 text-white text-[11px] font-black cursor-pointer hover:bg-blue-700 text-center flex items-center justify-center gap-2"
                onClick={() => {
                  searchBusLine(searchQuery);
                  setSearchResults([]);
                }}
              >
                <Bus size={14} /> {isSearchingLines ? '搜索线路中...' : `作为公交线路搜索: "${searchQuery}"`}
              </div>
            </div>
          )}
        </div>

        {/* Station List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar bg-slate-50/50">
          {activePlan.stations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-300 space-y-4 text-center">
              <div className="w-16 h-16 rounded-3xl bg-white flex items-center justify-center shadow-inner">
                <MapPin size={32} />
              </div>
              <p className="text-xs font-medium uppercase tracking-widest">点击地图或搜索以开始</p>
            </div>
          ) : (
            activePlan.stations.map((s, idx) => (
              <React.Fragment key={s.id}>
                {/* Station */}
                <div className="group bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-xl transition-all duration-300 relative overflow-hidden">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black text-white shrink-0 shadow-lg",
                      idx === 0 ? "bg-emerald-500 shadow-emerald-200" : idx === activePlan.stations.length - 1 ? "bg-rose-500 shadow-rose-200" : "bg-blue-500 shadow-blue-200"
                    )}>
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <input 
                        className="font-black text-sm bg-transparent border-none focus:outline-none w-full text-slate-800"
                        value={s.name}
                        onChange={(e) => updateStationName(s.id, e.target.value)}
                      />
                      <div className="text-[10px] text-slate-400 font-mono mt-1">
                        {s.lat.toFixed(6)}N, {s.lng.toFixed(6)}E
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-all scale-90">
                      <button onClick={() => moveStation(s.id, 'up')} className="p-1 hover:bg-slate-100 rounded text-slate-400"><ChevronUp size={16}/></button>
                      <button onClick={() => moveStation(s.id, 'down')} className="p-1 hover:bg-slate-100 rounded text-slate-400"><ChevronDown size={16}/></button>
                    </div>
                    <button 
                      onClick={() => removeStation(s.id)}
                      className="p-2.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all shrink-0"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                {/* Leg */}
                {idx < activePlan.stations.length - 1 && (
                  <div className="relative py-2 ml-4 pl-10 border-l-4 border-dashed border-slate-200/50">
                    <div className="absolute left-[-18px] top-1/2 -translate-y-1/2 flex flex-col items-center gap-3">
                      <div className="bg-white p-1 rounded-2xl border border-slate-200 shadow-xl z-10 flex gap-0.5">
                        {TRANSPORT_MODES.map(m => (
                          <button
                            key={m.mode}
                            onClick={() => updateStationMode(s.id, m.mode)}
                            className={cn(
                              "p-2 rounded-xl transition-all",
                              s.modeAfter === m.mode 
                                ? "bg-blue-600 text-white shadow-lg shadow-blue-200" 
                                : "text-slate-300 hover:text-slate-600 hover:bg-slate-50"
                            )}
                            title={m.label}
                          >
                            {m.icon}
                          </button>
                        ))}
                      </div>
                      <div className="text-[10px] font-black text-blue-600 bg-white px-3 py-1 rounded-full border border-blue-100 shadow-sm whitespace-nowrap">
                        {stats.legs[idx]?.d.toFixed(2)} km · {Math.round(stats.legs[idx]?.t)} min
                      </div>
                    </div>
                  </div>
                )}
              </React.Fragment>
            ))
          )}
        </div>

        {/* Other Plans as Reference */}
        {plans.length > 1 && (
          <div className="bg-white border-t border-slate-100 p-4 shrink-0">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              <Layers size={14} className="text-blue-500" /> 参考其他规划
            </h3>
            <div className="flex flex-wrap gap-2">
              {plans.filter(p => p.id !== activePlanId).map(p => (
                <button
                  key={p.id}
                  onClick={() => {
                    const currentRefs = activePlan.visibleReferences || [];
                    const newRefs = currentRefs.includes(p.id) 
                      ? currentRefs.filter(rid => rid !== p.id) 
                      : [...currentRefs, p.id];
                    setPlans(prev => prev.map(pl => pl.id === activePlanId ? { ...pl, visibleReferences: newRefs } : pl));
                  }}
                  className={cn(
                    "px-3 py-1.5 rounded-xl text-[10px] font-black transition-all border flex items-center gap-2",
                    (activePlan.visibleReferences || []).includes(p.id)
                      ? "bg-blue-50 border-blue-200 text-blue-600"
                      : "bg-slate-50 border-slate-200 text-slate-400"
                  )}
                >
                  <MapPin size={10} /> {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Reference Lines */}
        {referenceLines.length > 0 && (
          <div className="bg-white border-t border-slate-100 p-4 max-h-48 overflow-y-auto no-scrollbar">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Bus size={14} className="text-blue-500" /> 参考公交线路
            </h3>
            <div className="space-y-3">
              {referenceLines.map(line => (
                <div key={line.id} className="bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden">
                  <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="p-1.5 bg-blue-100 text-blue-600 rounded-lg"><Bus size={14} /></div>
                      <span className="text-xs font-black truncate text-slate-700">{line.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setReferenceLines(prev => prev.map(l => l.id === line.id ? { ...l, active: !l.active } : l))}
                        className={cn("p-1.5 rounded-lg transition-all", line.active ? "bg-blue-600 text-white shadow-md shadow-blue-100" : "bg-slate-200 text-slate-400")}
                      >
                        <Layers size={14} />
                      </button>
                      <button onClick={() => setReferenceLines(prev => prev.filter(l => l.id !== line.id))} className="text-slate-300 hover:text-rose-500"><X size={16} /></button>
                    </div>
                  </div>
                  {line.active && (
                    <div className="px-3 pb-3 flex flex-wrap gap-1.5">
                      {line.stops.slice(0, 15).map((stop, si) => (
                        <button 
                          key={si}
                          onClick={() => addStation(stop.name, stop.lat, stop.lng)}
                          className="text-[9px] px-2 py-1 bg-white border border-slate-200 rounded-md text-slate-500 hover:border-blue-300 hover:text-blue-500 transition-colors truncate max-w-[100px]"
                        >
                          {stop.name}
                        </button>
                      ))}
                      {line.stops.length > 15 && <span className="text-[9px] text-slate-400 py-1">...等{line.stops.length}站</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer Stats */}
        <div className="p-5 bg-white border-t border-slate-200">
          <div className="flex items-center justify-between mb-6">
            <div className="space-y-1">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">总里程</div>
              <div className="text-2xl font-black text-slate-900 tracking-tighter">{stats.dist.toFixed(2)} <span className="text-xs font-normal text-slate-400 italic">km</span></div>
            </div>
            <div className="text-right space-y-1">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">预计用时</div>
              <div className="text-2xl font-black text-slate-900 tracking-tighter">
                {Math.floor(stats.time / 60)} <span className="text-xs font-normal text-slate-400 italic">h</span> {Math.round(stats.time % 60)} <span className="text-xs font-normal text-slate-400 italic">m</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 no-export">
            <button 
              onClick={() => {
                const blob = new Blob([JSON.stringify(activePlan)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `${activePlan.name}.json`;
                a.click();
              }}
              className="flex items-center justify-center gap-2 py-3 bg-slate-100 hover:bg-slate-200 rounded-2xl text-[11px] font-black transition-all"
            >
              <FileDown size={14} /> 导出 JSON
            </button>
            <label className="flex items-center justify-center gap-2 py-3 bg-slate-100 hover:bg-slate-200 rounded-2xl text-[11px] font-black transition-all cursor-pointer">
              <Upload size={14} /> 导入 JSON
              <input type="file" className="hidden" accept=".json" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const r = new FileReader();
                  r.onload = (ev) => {
                    const imported = JSON.parse(ev.target?.result as string);
                    const id = Math.random().toString(36).substr(2, 9);
                    setPlans([...plans, { ...imported, id }]);
                    setActivePlanId(id);
                  };
                  r.readAsText(f);
                }
              }} />
            </label>
            <button 
              onClick={exportAsImage}
              className="flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-[11px] font-black transition-all shadow-lg shadow-indigo-200"
            >
              <ImageIcon size={14} /> 导出为图片
            </button>
            <button 
              onClick={() => window.print()}
              className="flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-[11px] font-black transition-all shadow-lg shadow-blue-200"
            >
              <Printer size={14} /> 打印/PDF
            </button>
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative bg-slate-200">
        <MapContainer 
          center={toMap(32.89, 115.81)} 
          zoom={12} 
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
          maxBounds={[[15.0, 70.0], [55.0, 140.0]]}
        >
          {/* Gaode Tile Layer */}
          <TileLayer
            attribution='&copy; <a href="http://www.amap.com/">AutoNavi</a>'
            url="http://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}"
          />
          
          <MapEvents onMapClick={(lat, lng) => addStation(`站点 ${activePlan.stations.length + 1}`, lat, lng)} />
          <MapUpdater center={mapCenter} />

          {/* Referenced Other Plans - Rendered in faint gray */}
          {(activePlan.visibleReferences || []).map(refId => {
            const refPlan = plans.find(p => p.id === refId);
            if (!refPlan) return null;
            return (
              <React.Fragment key={`ref-plan-${refId}`}>
                {refPlan.stations.map((s, idx) => {
                  if (idx === refPlan.stations.length - 1) return null;
                  const next = refPlan.stations[idx + 1];
                  return (
                    <Polyline 
                      key={`ref-path-${s.id}`}
                      positions={[toMap(s.lat, s.lng), toMap(next.lat, next.lng)]}
                      pathOptions={{ color: '#94a3b8', weight: 4, opacity: 0.3, dashArray: '5, 5' }}
                    />
                  );
                })}
                {refPlan.stations.map((s) => (
                  <Marker 
                    key={`ref-station-${s.id}`}
                    position={toMap(s.lat, s.lng)}
                    icon={L.divIcon({
                      className: 'ref-dot',
                      html: `<div style="background-color: #cbd5e1; width: 10px; height: 10px; border-radius: 50%; border: 1px solid white;"></div>`,
                      iconSize: [10, 10],
                      iconAnchor: [5, 5]
                    })}
                  >
                    <Popup>{refPlan.name}: {s.name}</Popup>
                  </Marker>
                ))}
              </React.Fragment>
            );
          })}

          {/* Reference Lines - Light Gray */}
          {referenceLines.filter(l => l.active).map(line => (
            <React.Fragment key={line.id}>
              <Polyline 
                positions={line.points.map(p => toMap(p[0], p[1]))} 
                pathOptions={{ color: '#cbd5e1', weight: 4, opacity: 0.5, dashArray: '8, 8' }} 
              />
              {line.stops.map((stop, i) => (
                <Marker 
                  key={`${line.id}-stop-${i}`} 
                  position={toMap(stop.lat, stop.lng)}
                  icon={L.divIcon({
                    className: 'stop-dot',
                    html: `<div style="background-color: #94a3b8; width: 6px; height: 6px; border-radius: 50%; border: 1px solid white;"></div>`,
                    iconSize: [6, 6],
                    iconAnchor: [3, 3]
                  })}
                >
                  <Popup>{stop.name}</Popup>
                </Marker>
              ))}
            </React.Fragment>
          ))}

          {/* Active Plan Paths */}
          {activePlan.stations.map((s, idx) => {
            if (idx === activePlan.stations.length - 1) return null;
            const next = activePlan.stations[idx + 1];
            const mode = TRANSPORT_MODES.find(m => m.mode === s.modeAfter) || TRANSPORT_MODES[0];
            
            let path: [number, number][] = [toMap(s.lat, s.lng), toMap(next.lat, next.lng)];
            
            // Highlight Logic: If consecutive stations are part of a reference line, follow it
            const matchedLine = referenceLines.find(line => {
              const hasA = line.stops.some(st => Math.abs(st.lat - s.lat) < 0.001 && Math.abs(st.lng - s.lng) < 0.001);
              const hasB = line.stops.some(st => Math.abs(st.lat - next.lat) < 0.001 && Math.abs(st.lng - next.lng) < 0.001);
              return hasA && hasB;
            });

            if (matchedLine) {
              const idxA = matchedLine.points.findIndex(p => Math.abs(p[0] - s.lat) < 0.005 && Math.abs(p[1] - s.lng) < 0.005);
              const idxB = matchedLine.points.findIndex(p => Math.abs(p[0] - next.lat) < 0.005 && Math.abs(p[1] - next.lng) < 0.005);
              if (idxA !== -1 && idxB !== -1) {
                const sub = idxA < idxB 
                  ? matchedLine.points.slice(idxA, idxB + 1) 
                  : matchedLine.points.slice(idxB, idxA + 1).reverse();
                path = sub.map(p => toMap(p[0], p[1]));
              }
            }
            
            return (
              <React.Fragment key={`path-${s.id}`}>
                <Polyline 
                  positions={path}
                  pathOptions={{ 
                    color: mode.color, 
                    weight: 6, 
                    opacity: 0.9,
                    lineJoin: 'round',
                    dashArray: s.modeAfter === 'walking' ? '5, 10' : undefined 
                  }}
                />
                <Marker position={path[Math.floor(path.length / 2)]} icon={getModeIcon(mode.emoji)} />
              </React.Fragment>
            );
          })}

          {/* Station Markers */}
          {activePlan.stations.map((s, idx) => (
            <Marker 
              key={s.id} 
              position={toMap(s.lat, s.lng)} 
              icon={getStationIcon(idx, activePlan.stations.length)}
              draggable={true}
              eventHandlers={{
                dragend: (e: any) => {
                  const { lat, lng } = e.target.getLatLng();
                  const [wlng, wlat] = gcoord.transform([lng, lat], gcoord.GCJ02, gcoord.WGS84);
                  setPlans(prev => prev.map(p => 
                    p.id === activePlanId ? { 
                      ...p, 
                      stations: p.stations.map(st => st.id === s.id ? { ...st, lat: wlat, lng: wlng } : st) 
                    } : p
                  ));
                }
              }}
            >
              <Popup>
                <div className="font-bold p-1">{s.name}</div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {/* Floating UI Elements */}
        <div className="absolute top-6 right-6 flex flex-col gap-3 z-[1000]">
          <div className="bg-white/80 backdrop-blur-md p-2 rounded-2xl shadow-2xl border border-white/50 flex flex-col gap-2">
            <button onClick={() => {}} className="p-3 hover:bg-white rounded-xl text-slate-600 transition-all shadow-sm"><Navigation size={22} /></button>
            <div className="h-[1px] bg-slate-200 mx-2" />
            <button onClick={() => {}} className="p-3 hover:bg-white rounded-xl text-slate-600 transition-all shadow-sm"><Layers size={22} /></button>
          </div>
        </div>

        <div className="absolute bottom-6 left-6 z-[1000] bg-white/80 backdrop-blur-md px-4 py-2 rounded-xl border border-white/50 shadow-xl text-[10px] font-mono text-slate-400">
          WGS-84 DATA / GCJ-02 RENDER
        </div>
      </div>

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .custom-station-icon { background: none; border: none; }
        .mode-marker-icon { background: none; border: none; }
        @media print {
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; }
          .w-96 { width: 100% !important; border: none !important; }
          .h-screen { height: auto !important; overflow: visible !important; }
        }
      `}</style>
    </div>
  );
}
