package com.unbeat.playlist.userplaylist

import com.unbeat.playlist.profile.UserProfileRepository
import com.unbeat.playlist.userplaylist.dto.PlaylistRequest
import com.unbeat.playlist.userplaylist.dto.PlaylistResponse
import com.unbeat.playlist.userplaylist.dto.PlaylistTrackRequest
import com.unbeat.playlist.userplaylist.dto.PlaylistTrackResponse
import com.unbeat.playlist.userplaylist.dto.PublicPlaylistResponse
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.format.DateTimeFormatter

// (게이미피케이션 2단계) 공개 전환 결과 — 단순 Boolean/null로는 "재생목록이 없음"과 "로그인
// 안 해서 막힘"을 컨트롤러가 구분 못 해서(각각 404/403으로 다르게 응답해야 함) sealed class로 분리.
// NicknameRequired(2.5단계, 2026-10-10 추가): 로그인은 돼 있지만 아직 닉네임을 안 정한 경우 —
// "처음 공개 전환할 때 닉네임 설정을 유도"하기로 한 결정([[학습노트 90번]] 예정) 때문에
// LoginRequired(403)와는 다른 상태코드(428)로 분리해서 프론트가 "로그인 모달"과 "닉네임
// 설정 모달" 중 어느 걸 띄울지 명확히 구분할 수 있게 함.
// CategoryRequired(랭킹 카테고리 필터, 2026-10-10 추가): "재생목록 만들 때 장벽이 생기면 안
// 된다"는 이유로 닉네임과 똑같이 카테고리도 "공개로 전환할 때"만 요구함. 닉네임(428)과는 또
// 다른 이유의 거부라 상태코드를 따로 둠(400 — 입력값 자체가 비거나 잘못됨, 로그인/프로필
// 상태와 무관한 단순 검증 실패라는 의미에서 428/403과 구분).
sealed class VisibilityResult {
    data class Success(val response: PlaylistResponse) : VisibilityResult()
    object NotFound : VisibilityResult()
    object LoginRequired : VisibilityResult()
    object NicknameRequired : VisibilityResult()
    object CategoryRequired : VisibilityResult()
}

// (게이미피케이션 3단계) 좋아요 토글 결과 — VisibilityResult와 같은 패턴. 좋아요는 공개
// 재생목록에만 허용(비공개 재생목록 id를 안다고 좋아요를 누를 수 있으면 안 되므로 NotFound로
// 통일 — 존재 자체를 숨김, "있는데 비공개라 거부"가 아니라 "그런 건 없다"로 응답).
sealed class LikeResult {
    data class Success(val likeCount: Int, val likedByMe: Boolean) : LikeResult()
    object NotFound : LikeResult()
    object LoginRequired : LikeResult()
}

@Service
class PlaylistService(
    private val playlistRepository: PlaylistRepository,
    private val playlistTrackRepository: PlaylistTrackRepository,
    private val userProfileRepository: UserProfileRepository,
    private val playlistLikeRepository: PlaylistLikeRepository
) {

    fun list(sessionId: String): List<PlaylistResponse> =
        playlistRepository.findBySessionIdOrderByCreatedAtDesc(sessionId).map { it.toResponse() }

    // userId: SupabaseAuth로 뽑은 UUID(비로그인이면 null) — 생성 시점에 로그인 상태였는지만
    // 기록해둠. 나중에 이 재생목록을 공개로 전환하려면 이 값이 있어야 함(setVisibility 참고).
    fun create(sessionId: String, userId: String?, request: PlaylistRequest): PlaylistResponse {
        val name = request.name.trim().ifBlank { "새 재생목록" }
        val saved = playlistRepository.save(Playlist(sessionId = sessionId, name = name, userId = userId))
        return saved.toResponse()
    }

    fun delete(sessionId: String, playlistId: Long): Boolean {
        val playlist = playlistRepository.findById(playlistId).orElse(null) ?: return false
        if (playlist.sessionId != sessionId) return false
        playlistTrackRepository.deleteByPlaylistId(playlistId)
        playlistRepository.delete(playlist)
        return true
    }

    // 소유자(세션 일치)는 공개 여부와 무관하게 항상 자기 재생목록 곡을 볼 수 있고, 소유자가 아니어도
    // 공개 재생목록이면 "둘러보기" 피드에서 클릭해 들어온 걸로 보고 허용 — 비공개인데 소유자가
    // 아니면 지금까지와 동일하게 거부.
    fun getTracks(sessionId: String, playlistId: Long): List<PlaylistTrackResponse>? {
        val playlist = playlistRepository.findById(playlistId).orElse(null) ?: return null
        if (playlist.sessionId != sessionId && !playlist.isPublic) return null
        return playlistTrackRepository.findByPlaylistIdOrderByAddedAtDesc(playlistId).map { it.toResponse() }
    }

    // 공개 전환은 로그인(userId가 있는 요청)에서만 허용 — ROADMAP에서 "좋아요/랭킹이 session_id로는
    // 안 되고 UUID가 꼭 필요하다"고 정한 전제를 여기서 강제함. 재생목록 자체가 비로그인 때 만든
    // 것이어도(playlist.userId가 null이어도) 지금 요청에 로그인이 돼 있으면 그 시점의 userId를
    // 새로 채워서 공개로 전환할 수 있게 함 — "나중에 로그인했으니 이제 공개하고 싶다"는 자연스러운
    // 사용 흐름을 막지 않기 위함(생성 시점 로그인 여부로 영구히 막아버리면 너무 엄격함).
    fun setVisibility(
        sessionId: String,
        userId: String?,
        playlistId: Long,
        isPublic: Boolean,
        category: String? = null
    ): VisibilityResult {
        val playlist = playlistRepository.findById(playlistId).orElse(null) ?: return VisibilityResult.NotFound
        if (playlist.sessionId != sessionId) return VisibilityResult.NotFound
        if (isPublic) {
            if (userId == null) return VisibilityResult.LoginRequired
            // (2.5단계) 닉네임이 있어야만 공개 허용 — 공개 피드/프로필 페이지가 닉네임 기준으로
            // 사람을 식별하는데, 닉네임 없이 공개부터 시키면 "주인 없는" 공개 재생목록이 생겨버림.
            if (userProfileRepository.findByUserId(userId) == null) return VisibilityResult.NicknameRequired
            // (랭킹 카테고리 필터) 고정 목록(MUSIC_CATEGORIES)에 있는 값만 허용 — 자유 입력을
            // 받으면 필터링이 무의미해지므로 프론트가 뭘 보내든 서버에서 한 번 더 검증.
            if (category == null || !MUSIC_CATEGORIES.containsKey(category)) return VisibilityResult.CategoryRequired
            playlist.userId = userId
            playlist.category = category
        }
        playlist.isPublic = isPublic
        val saved = playlistRepository.save(playlist)
        return VisibilityResult.Success(saved.toResponse())
    }

    // (게이미피케이션 2단계, 2.5단계 ownerNickname, 3단계 좋아요 정렬) 다른 사용자가 공개한
    // 재생목록 둘러보기 피드. "랭킹"이라는 이름에 맞게 좋아요 많은 순으로 정렬 — 처음엔 등수
    // 배지(금/은/동)로 보여줬다가 "짜치다"는 반응으로 빼고, 정렬 순서 자체가 랭킹 역할을 하게
    // 바꿈(동점이면 최신순으로 안정적 타이브레이크). 페이지네이션은 MVP 범위 밖이라 50개로 자름.
    // viewerId: 요청자의 로그인 UUID(비로그인이면 null) — likedByMe 계산에만 씀.
    fun listPublic(limit: Int = 50, viewerId: String? = null): List<PublicPlaylistResponse> =
        playlistRepository.findByIsPublicTrueOrderByCreatedAtDesc()
            .map { it.toPublicResponse(viewerId) }
            .sortedByDescending { it.likeCount }
            .take(limit)

    // (2.5단계, 3단계 좋아요 정렬 동일 적용) 프로필 페이지용 — 닉네임 하나가 가진 모든 공개 재생목록.
    fun listPublicByUserId(userId: String, limit: Int = 50, viewerId: String? = null): List<PublicPlaylistResponse> =
        playlistRepository.findByUserIdAndIsPublicTrueOrderByCreatedAtDesc(userId)
            .map { it.toPublicResponse(viewerId) }
            .sortedByDescending { it.likeCount }
            .take(limit)

    // (게이미피케이션 3단계) 좋아요 토글 — 멱등: 이미 좋아요 상태에서 like()를 또 불러도 중복
    // 레코드가 안 쌓임(existsBy로 먼저 확인). 비공개 재생목록은 존재 자체를 숨기려고 NotFound로
    // 통일(공개 피드에 없는 id로 좋아요를 시도해도 "있는데 비공개라서 안 됨"이라고 알려주지 않음).
    fun like(userId: String?, playlistId: Long): LikeResult {
        if (userId == null) return LikeResult.LoginRequired
        val playlist = playlistRepository.findById(playlistId).orElse(null) ?: return LikeResult.NotFound
        if (!playlist.isPublic) return LikeResult.NotFound
        if (!playlistLikeRepository.existsByPlaylistIdAndUserId(playlistId, userId)) {
            playlistLikeRepository.save(PlaylistLike(playlistId = playlistId, userId = userId))
        }
        return LikeResult.Success(playlistLikeRepository.countByPlaylistId(playlistId).toInt(), likedByMe = true)
    }

    // (버그 수정, 2026-10-14) 라이브 테스트 중 좋아요 취소(DELETE /{id}/like)가 500으로 터지는 걸
    // 발견 — Network 탭으로 직접 확인. 원인은 `deleteByPlaylistIdAndUserId`가 Spring Data가 자동
    // 인식하는 기본 CRUD 메서드(save/deleteById 등)가 아니라 직접 선언한 커스텀 derived 쿼리라,
    // Spring Data의 "리포지토리 기본 트랜잭션" 처리가 이걸 읽기 전용으로 잡아버려서(쓰기 메서드로
    // 인식 못 함) 트랜잭션의 DB 커넥션이 read-only로 설정됨 — 그 상태에서 실제 DELETE를 실행하려
    // 하니 DB(MariaDB)가 "커넥션이 읽기 전용이라 쓰기 불가" 에러를 던진 것. `like()`는 같은 문제가
    // 없었는데, 거긴 Spring Data가 기본 제공하는 `save()`(JpaRepository 표준 메서드라 항상 쓰기로
    // 인식됨)만 써서 우연히 안전했던 것뿐. `@Transactional`을 명시적으로 붙여서 이 메서드 호출
    // 전체를 쓰기 가능한 트랜잭션으로 강제 — 네트워크 탭에서 확인한 500 에러를 근거로 수정.
    @Transactional
    fun unlike(userId: String?, playlistId: Long): LikeResult {
        if (userId == null) return LikeResult.LoginRequired
        val playlist = playlistRepository.findById(playlistId).orElse(null) ?: return LikeResult.NotFound
        if (!playlist.isPublic) return LikeResult.NotFound
        playlistLikeRepository.deleteByPlaylistIdAndUserId(playlistId, userId)
        return LikeResult.Success(playlistLikeRepository.countByPlaylistId(playlistId).toInt(), likedByMe = false)
    }

    private fun Playlist.toPublicResponse(viewerId: String?) = PublicPlaylistResponse(
        id = id!!,
        name = name,
        createdAt = createdAt.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME),
        trackCount = playlistTrackRepository.countByPlaylistId(id!!).toInt(),
        // userId가 null일 일은 없음(공개 전환 시 항상 채워짐)이지만, 혹시 모를 과거 데이터 방어용으로 ?.let
        ownerNickname = userId?.let { uid -> userProfileRepository.findByUserId(uid)?.nickname },
        coverImageUrl = playlistTrackRepository.findFirstByPlaylistIdAndImageUrlIsNotNullOrderByAddedAtDesc(id!!)
            ?.imageUrl,
        likeCount = playlistLikeRepository.countByPlaylistId(id!!).toInt(),
        likedByMe = viewerId != null && playlistLikeRepository.existsByPlaylistIdAndUserId(id!!, viewerId),
        category = category
    )

    // 이미 그 재생목록에 있는 곡이면 새로 안 만들고 기존 걸 그대로 반환 (FavoriteTrackService.add와 같은 멱등 처리)
    fun addTrack(sessionId: String, playlistId: Long, request: PlaylistTrackRequest): PlaylistTrackResponse? {
        val playlist = playlistRepository.findById(playlistId).orElse(null) ?: return null
        if (playlist.sessionId != sessionId) return null

        val existing = playlistTrackRepository.findByPlaylistIdAndArtistNameAndTrackName(
            playlistId, request.artistName, request.trackName
        )
        if (existing != null) return existing.toResponse()

        val saved = playlistTrackRepository.save(
            PlaylistTrack(
                playlistId = playlistId,
                artistName = request.artistName,
                trackName = request.trackName,
                url = request.trackUrl,
                imageUrl = request.imageUrl
            )
        )
        return saved.toResponse()
    }

    fun removeTrack(sessionId: String, playlistId: Long, trackId: Long): Boolean {
        val playlist = playlistRepository.findById(playlistId).orElse(null) ?: return false
        if (playlist.sessionId != sessionId) return false

        val track = playlistTrackRepository.findById(trackId).orElse(null) ?: return false
        if (track.playlistId != playlistId) return false

        playlistTrackRepository.delete(track)
        return true
    }

    private fun Playlist.toResponse() = PlaylistResponse(
        id = id!!,
        name = name,
        createdAt = createdAt.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME),
        trackCount = playlistTrackRepository.countByPlaylistId(id!!).toInt(),
        isAutoGenerated = isAutoGenerated,
        isPublic = isPublic
    )

    private fun PlaylistTrack.toResponse() = PlaylistTrackResponse(
        id = id!!,
        artistName = artistName,
        trackName = trackName,
        url = url,
        imageUrl = imageUrl,
        addedAt = addedAt.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME)
    )
}
