import Image from "next/image";
import type { Artist } from "@/lib/api";

type ArtistCardProps = {
  artist: Artist;
  isSelected: boolean;
  onSelect: (artistName: string) => void;
};

export default function ArtistCard({ artist, isSelected, onSelect }: ArtistCardProps) {
  return (
    <button
      onClick={() => onSelect(artist.name)}
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
        isSelected
          ? "border-accent bg-accent/10"
          : "border-white/10 bg-white/5 hover:border-white/30"
      }`}
    >
      {artist.image ? (
        <Image
          src={artist.image}
          alt={artist.name}
          width={48}
          height={48}
          className="rounded-full object-cover"
          unoptimized
        />
      ) : (
        <div className="h-12 w-12 rounded-full bg-white/10" />
      )}
      <div>
        <p className="text-sm font-medium">{artist.name}</p>
        <p className="text-xs text-white/50">청취자 {Number(artist.listeners).toLocaleString()}명</p>
      </div>
    </button>
  );
}
