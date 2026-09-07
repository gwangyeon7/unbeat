import type { FavoriteTrack } from "@/lib/playlistApi";
import type { Track } from "@/lib/api";
import CompactTrackRow from "./CompactTrackRow";

type FavoriteTrackRowProps = {
  track: FavoriteTrack;
  onPlay: (track: { name: string; artist: string; image?: string | null }) => void;
  onToggleFavorite: (track: Track) => void;
  onAddToPlaylist?: (track: { name: string; artist: string; image?: string | null }) => void;
};

// 즐겨찾기(다시 듣기) 목록에서 재사용하는 곡 한 줄. "너무 다 카드트랙일 필요는 없다"는
// 피드백으로, 무드 탐색 결과(CompactTrackGrid)와 같은 줄 스타일(CompactTrackRow)을 씀 —
// 다만 여긴 사이드바처럼 폭이 좁은 자리라 3열 그리드 대신 1열로 세로로만 쌓음.
// 썸네일은 FavoriteTrack에 저장된 이미지 URL이 없어서(즐겨찾기 도메인엔 image 컬럼이 없음)
// 항상 플레이스홀더 아이콘으로 뜸 — 실제 앨범아트를 보여주려면 백엔드에 image 컬럼 추가가 필요함.
export default function FavoriteTrackRow({
  track,
  onPlay,
  onToggleFavorite,
  onAddToPlaylist,
}: FavoriteTrackRowProps) {
  return (
    <CompactTrackRow
      title={track.trackName}
      subtitle={track.artistName}
      image={null}
      isFavorite={true}
      onPlay={() => onPlay({ name: track.trackName, artist: track.artistName })}
      onToggleFavorite={() =>
        onToggleFavorite({
          name: track.trackName,
          artist: track.artistName,
          listeners: null,
          url: track.url ?? "",
          image: null,
        })
      }
      onAddToPlaylist={
        onAddToPlaylist ? () => onAddToPlaylist({ name: track.trackName, artist: track.artistName }) : undefined
      }
    />
  );
}
