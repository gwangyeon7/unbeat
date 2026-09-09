package com.unbeat.playlist.favoritetrack

import com.unbeat.playlist.favoritetrack.dto.FavoriteTrackRequest
import com.unbeat.playlist.favoritetrack.dto.FavoriteTrackResponse
import com.unbeat.playlist.lastfm.LastFmTagClient
import org.springframework.stereotype.Service
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

@Service
class FavoriteTrackService(
    private val favoriteTrackRepository: FavoriteTrackRepository,
    private val lastFmTagClient: LastFmTagClient
) {

    fun list(sessionId: String): List<FavoriteTrackResponse> =
        favoriteTrackRepository.findBySessionIdOrderByCreatedAtDesc(sessionId).map { it.toResponse() }

    fun add(sessionId: String, request: FavoriteTrackRequest): FavoriteTrackResponse {
        val existing = favoriteTrackRepository.findBySessionIdAndArtistNameAndTrackName(
            sessionId, request.artistName, request.trackName
        )
        if (existing != null) {
            return existing.toResponse()
        }

        // 저장 시점에 Last.fm 태그를 바로 가져와서 같이 저장 — 나중 배치 처리가 이 값만 읽으면 되게
        // 곡 단위 태그가 비어있으면(케이팝처럼 트랙 태그가 빈약한 경우) 아티스트 단위 태그로 한 번 더 시도
        val trackTags = lastFmTagClient.fetchTopTags(request.artistName, request.trackName)
        val tags = trackTags.ifEmpty { lastFmTagClient.fetchArtistTags(request.artistName) }

        val saved = favoriteTrackRepository.save(
            FavoriteTrack(
                sessionId = sessionId,
                artistName = request.artistName,
                trackName = request.trackName,
                tags = tags.joinToString(",").ifBlank { null },
                url = request.trackUrl
            )
        )
        return saved.toResponse()
    }

    fun remove(sessionId: String, favoriteTrackId: Long): Boolean {
        val track = favoriteTrackRepository.findById(favoriteTrackId).orElse(null) ?: return false
        if (track.sessionId != sessionId) return false
        favoriteTrackRepository.delete(track)
        return true
    }

    /**
     * 즐겨찾기한 곡 카드를 클릭해서 원곡 링크로 나갈 때 호출됨 — "재생 의도" 신호를 기록.
     * 다른 세션 소유 곡을 갱신 못 하게 소유권 체크는 remove()와 동일하게 적용.
     */
    fun markOpened(sessionId: String, favoriteTrackId: Long): FavoriteTrackResponse? {
        val track = favoriteTrackRepository.findById(favoriteTrackId).orElse(null) ?: return null
        if (track.sessionId != sessionId) return null
        track.lastOpenedAt = LocalDateTime.now()
        return favoriteTrackRepository.save(track).toResponse()
    }

    /**
     * "즐겨찾기는 해뒀는데 시간이 지나면 안 듣는 곡도 생기지 않냐, 그런 곡을 분석해서 지워도 되는지
     * 물어봐주는 기능을 원한다"는 피드백으로 추가. 무작정 지우는 게 아니라 "지워도 될까요?"를
     * 물어보는 후보 목록만 반환 — 실제 삭제는 사용자가 고른 것만 프론트에서 기존 remove()로 개별 호출함.
     *
     * "안 들었다"의 기준점은 lastOpenedAt(재생 의도 신호)을 우선 쓰고, 그게 없으면(즐겨찾기한 뒤로
     * 한 번도 재생 버튼을 안 누른 곡) createdAt(즐겨찾기한 시점)을 대신 씀 — 둘 다 "최근에 이 곡과
     * 상호작용한 마지막 시점"이라는 같은 의미라서 하나로 합쳐 비교 가능.
     */
    fun findStale(sessionId: String, months: Long): List<FavoriteTrackResponse> {
        val cutoff = LocalDateTime.now().minusMonths(months)
        return favoriteTrackRepository.findBySessionIdOrderByCreatedAtDesc(sessionId)
            .filter { (it.lastOpenedAt ?: it.createdAt).isBefore(cutoff) }
            .map { it.toResponse() }
    }

    private fun FavoriteTrack.toResponse() = FavoriteTrackResponse(
        id = id!!,
        artistName = artistName,
        trackName = trackName,
        tags = tags?.split(",")?.filter { it.isNotBlank() } ?: emptyList(),
        url = url,
        createdAt = createdAt.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME),
        lastOpenedAt = lastOpenedAt?.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME)
    )
}
