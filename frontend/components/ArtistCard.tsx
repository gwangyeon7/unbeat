import Image from "next/image";
import type { Artist } from "@/lib/api";

type ArtistCardProps = {
  artist: Artist;
  isSelected: boolean;
  isFavorite: boolean;
  onSelect: (artistName: string) => void;
  onToggleFavorite: (artist: Artist) => void;
};

export default function ArtistCard({
  artist,
  isSelected,
  isFavorite,
  onSelect,
  onToggleFavorite,
}: ArtistCardProps) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-4 py-3 transition ${
        isSelected
          ? "border-accent bg-accent/10"
          : "border-white/10 bg-white/5 hover:border-white/30"
      }`}
    >
      <button
        onClick={() => onSelect(artist.name)}
        className="flex flex-1 items-center gap-3 text-left"
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
          // 사진이 없으면 이름 첫 글자로 채움(빈 회색 원 대신)
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-base font-bold text-white/60">
            {artist.name.trim().charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <p className="text-sm font-medium">{artist.name}</p>
        </div>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(artist);
        }}
        aria-label={isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
        className="px-2 text-lg text-yellow-400"
      >
        {isFavorite ? "★" : "☆"}
      </button>
    </div>
  );
}
