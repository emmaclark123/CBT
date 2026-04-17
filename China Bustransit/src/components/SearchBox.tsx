
import React, { useState } from 'react';
import { Search, MapPin, Loader2 } from 'lucide-react';

interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
}

interface SearchBoxProps {
  onSelect: (lat: number, lng: number, name: string) => void;
}

export const SearchBox: React.FC<SearchBoxProps> = ({ onSelect }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      // Searching specifically in China for better results
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          query
        )}&countrycodes=cn&limit=5`
      );
      const data = await response.json();
      setResults(data);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative w-full">
      <form onSubmit={handleSearch} className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索站点或地名..."
          className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
        />
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        </div>
      </form>

      {results.length > 0 && (
        <div className="absolute z-[1000] w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {results.map((res, i) => (
            <button
              key={i}
              onClick={() => {
                onSelect(parseFloat(res.lat), parseFloat(res.lon), res.display_name.split(',')[0]);
                setResults([]);
                setQuery('');
              }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-start gap-2 border-b last:border-0"
            >
              <MapPin className="w-4 h-4 mt-0.5 text-blue-500 shrink-0" />
              <span className="truncate">{res.display_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
