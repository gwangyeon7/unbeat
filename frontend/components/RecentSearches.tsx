import Image from "next/image";
import type { RecentSearchArtist } from "@/lib/api";

type RecentSearchesProps = {
  artists: RecentSearchArtist[];
  onSelect: (artistName: string) => void;
};

// 왼쪽 사이드바 위젯. 검색 이벤트 로그를 그대로 재활용 — 새 데이터 저장 없이
// 이미 쌓이고 있던 이벤트 로그를 사용자에게 보이는 기능으로 뒤집은 것.
// 메인 트랙/아티스트 카드와 같은 카드 스타일(border + bg-white/5)을 써서
// 사이드바만 붕 떠 보이지 않게 맞춤.
export default function RecentSearches({ artists, onSelect }: RecentSearchesProps) {
  if (artists.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/30">
        아직 검색 기록이 없어요. 아티스트를 검색해보세요.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {artists.map((artist) => (
        <li key={artist.name}>
          <button
            onClick={() => onSelect(artist.name)}
            className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2 text-left transition hover:border-white/30"
          >
            <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-accent/30 to-white/5">
              {artist.image ? (
                <Image src={artist.image} alt={artist.name} fill sizes="32px" className="object-cover" unoptimized />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-white/40">
                  {artist.name.slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <span className="truncate text-sm text-white/80">{artist.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
