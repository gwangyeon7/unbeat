package com.unbeat.playlist.userplaylist

import com.unbeat.playlist.auth.SupabaseAuth
import com.unbeat.playlist.userplaylist.dto.PlaylistRequest
import com.unbeat.playlist.userplaylist.dto.PlaylistTrackRequest
import com.unbeat.playlist.userplaylist.dto.PlaylistVisibilityRequest
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/playlists")
class PlaylistController(
    private val playlistService: PlaylistService,
    private val autoPlaylistService: AutoPlaylistService,
    private val supabaseAuth: SupabaseAuth
) {

    @GetMapping
    fun list(@RequestHeader("X-Session-Id") sessionId: String) = playlistService.list(sessionId)

    // 즐겨찾기한 곡을 장르별로 분석해서 재생목록을 자동 생성 — "직접 이름 짓고 곡을 일일이 넣는 게
    // 뻔하다"는 피드백으로 추가. 매번 눌러도 중복이 안 쌓이게 이전 자동 생성 결과는 지우고 다시 만듦.
    @PostMapping("/auto-generate")
    fun generateAuto(@RequestHeader("X-Session-Id") sessionId: String) =
        autoPlaylistService.generate(sessionId)

    // (게이미피케이션 2단계, 3단계에서 authHeader 추가) 다른 사용자가 공개한 재생목록 둘러보기
    // 피드 — 로그인/세션 여부와 무관하게 누구나 볼 수 있음(공개로 설정한 쪽이 동의한 공개 범위).
    // 로그인한 요청이면 각 카드의 likedByMe를 채워주려고 Authorization 헤더를 선택적으로 받음
    // (없거나 검증 실패해도 전체 목록 조회 자체는 그대로 동작 — likedByMe만 전부 false).
    // /{id}보다 먼저 매핑해야 Spring이 "public"을 PathVariable id로 오인해서 매칭하는 걸 피할 수 있음.
    @GetMapping("/public")
    fun listPublic(@RequestHeader(value = "Authorization", required = false) authHeader: String?) =
        playlistService.listPublic(viewerId = supabaseAuth.getUserId(authHeader))

    @PostMapping
    fun create(
        @RequestHeader("X-Session-Id") sessionId: String,
        @RequestHeader(value = "Authorization", required = false) authHeader: String?,
        @RequestBody request: PlaylistRequest
    ): ResponseEntity<Any> {
        val userId = supabaseAuth.getUserId(authHeader)
        val response = playlistService.create(sessionId, userId, request)
        return ResponseEntity.status(HttpStatus.CREATED).body(response)
    }

    // (게이미피케이션 2단계) 공개/비공개 전환. 로그인 안 한 요청(Authorization 헤더 없음/검증 실패)이
    // isPublic=true로 바꾸려 하면 403 — "좋아요/랭킹은 UUID로 식별해야 해서 공개는 로그인 필수"라는
    // 정책을 여기서 강제(PlaylistService.setVisibility 참고).
    @PatchMapping("/{id}/visibility")
    fun setVisibility(
        @RequestHeader("X-Session-Id") sessionId: String,
        @RequestHeader(value = "Authorization", required = false) authHeader: String?,
        @PathVariable id: Long,
        @RequestBody request: PlaylistVisibilityRequest
    ): ResponseEntity<Any> {
        val userId = supabaseAuth.getUserId(authHeader)
        return when (
            val result = playlistService.setVisibility(sessionId, userId, id, request.isPublic, request.category)
        ) {
            is VisibilityResult.Success -> ResponseEntity.ok(result.response)
            is VisibilityResult.NotFound -> ResponseEntity.status(HttpStatus.NOT_FOUND).build()
            is VisibilityResult.LoginRequired -> ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(mapOf("error" to "공개로 전환하려면 로그인이 필요해요."))
            // (2.5단계) 428 Precondition Required — "로그인은 했지만 닉네임을 아직 안 정함"을
            // LoginRequired(403)와 다른 상태코드로 분리해서 프론트가 로그인 모달/닉네임 설정
            // 모달 중 어느 걸 띄울지 명확히 구분할 수 있게 함.
            is VisibilityResult.NicknameRequired -> ResponseEntity.status(HttpStatus.PRECONDITION_REQUIRED)
                .body(mapOf("error" to "공개로 전환하려면 먼저 닉네임을 정해주세요."))
            // (랭킹 카테고리 필터) 400 — 닉네임(428)과 다른 이유(단순 입력 검증 실패)라 구분.
            is VisibilityResult.CategoryRequired -> ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(mapOf("error" to "공개로 전환하려면 카테고리를 선택해주세요."))
        }
    }

    @DeleteMapping("/{id}")
    fun delete(
        @RequestHeader("X-Session-Id") sessionId: String,
        @PathVariable id: Long
    ): ResponseEntity<Any> {
        val removed = playlistService.delete(sessionId, id)
        return if (removed) ResponseEntity.noContent().build()
        else ResponseEntity.status(HttpStatus.NOT_FOUND).build()
    }

    @GetMapping("/{id}/tracks")
    fun getTracks(
        @RequestHeader("X-Session-Id") sessionId: String,
        @PathVariable id: Long
    ): ResponseEntity<Any> {
        val tracks = playlistService.getTracks(sessionId, id)
        return if (tracks != null) ResponseEntity.ok(tracks)
        else ResponseEntity.status(HttpStatus.NOT_FOUND).build()
    }

    @PostMapping("/{id}/tracks")
    fun addTrack(
        @RequestHeader("X-Session-Id") sessionId: String,
        @PathVariable id: Long,
        @RequestBody request: PlaylistTrackRequest
    ): ResponseEntity<Any> {
        val response = playlistService.addTrack(sessionId, id, request)
        return if (response != null) ResponseEntity.status(HttpStatus.CREATED).body(response)
        else ResponseEntity.status(HttpStatus.NOT_FOUND).build()
    }

    @DeleteMapping("/{id}/tracks/{trackId}")
    fun removeTrack(
        @RequestHeader("X-Session-Id") sessionId: String,
        @PathVariable id: Long,
        @PathVariable trackId: Long
    ): ResponseEntity<Any> {
        val removed = playlistService.removeTrack(sessionId, id, trackId)
        return if (removed) ResponseEntity.noContent().build()
        else ResponseEntity.status(HttpStatus.NOT_FOUND).build()
    }

    // (게이미피케이션 3단계) 좋아요 — 로그인 필수(세션이 아니라 UUID로 "같은 사람이 두 번 못
    // 누르게" 막아야 해서). X-Session-Id는 다른 엔드포인트와 헤더 형식을 맞추려고 그대로 받지만
    // 실제 좋아요 식별에는 안 씀(세션은 브라우저 데이터 초기화로 바뀌는 익명 식별자라 좋아요
    // 중복 방지 기준으로 못 씀 — [[학습노트 89번]]과 동일한 이유).
    @PostMapping("/{id}/like")
    fun like(
        @RequestHeader(value = "Authorization", required = false) authHeader: String?,
        @PathVariable id: Long
    ): ResponseEntity<Any> {
        val userId = supabaseAuth.getUserId(authHeader)
        return when (val result = playlistService.like(userId, id)) {
            is LikeResult.Success -> ResponseEntity.ok(mapOf("likeCount" to result.likeCount, "likedByMe" to result.likedByMe))
            is LikeResult.NotFound -> ResponseEntity.status(HttpStatus.NOT_FOUND).build()
            is LikeResult.LoginRequired -> ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(mapOf("error" to "좋아요를 누르려면 로그인이 필요해요."))
        }
    }

    @DeleteMapping("/{id}/like")
    fun unlike(
        @RequestHeader(value = "Authorization", required = false) authHeader: String?,
        @PathVariable id: Long
    ): ResponseEntity<Any> {
        val userId = supabaseAuth.getUserId(authHeader)
        return when (val result = playlistService.unlike(userId, id)) {
            is LikeResult.Success -> ResponseEntity.ok(mapOf("likeCount" to result.likeCount, "likedByMe" to result.likedByMe))
            is LikeResult.NotFound -> ResponseEntity.status(HttpStatus.NOT_FOUND).build()
            is LikeResult.LoginRequired -> ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(mapOf("error" to "좋아요를 누르려면 로그인이 필요해요."))
        }
    }
}
