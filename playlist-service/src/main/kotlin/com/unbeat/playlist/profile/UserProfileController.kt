package com.unbeat.playlist.profile

import com.unbeat.playlist.auth.SupabaseAuth
import com.unbeat.playlist.profile.dto.MyProfileResponse
import com.unbeat.playlist.profile.dto.NicknameResponse
import com.unbeat.playlist.profile.dto.SetNicknameRequest
import com.unbeat.playlist.profile.dto.UserProfilePageResponse
import com.unbeat.playlist.userplaylist.PlaylistService
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/profile")
class UserProfileController(
    private val userProfileService: UserProfileService,
    private val playlistService: PlaylistService,
    private val supabaseAuth: SupabaseAuth
) {

    // 로그인한 내 닉네임 조회 — 아직 안 정했으면 nickname: null (프론트가 이걸로 "공개 전환 시
    // 닉네임부터 물어봐야 하는지" 미리 판단하지는 않음, 428 응답이 그 역할을 함. 이건 보조용).
    @GetMapping("/me")
    fun me(@RequestHeader(value = "Authorization", required = false) authHeader: String?): ResponseEntity<Any> {
        val userId = supabaseAuth.getUserId(authHeader)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(mapOf("error" to "로그인이 필요해요."))
        return ResponseEntity.ok(MyProfileResponse(nickname = userProfileService.getNickname(userId)))
    }

    // (2.5단계) 재생목록을 처음 공개로 전환하려 할 때(428 NicknameRequired) 프론트가 유도해서
    // 호출하는 엔드포인트. 이미 닉네임이 있으면 변경으로 처리됨(UserProfileService.setNickname).
    @PostMapping("/nickname")
    fun setNickname(
        @RequestHeader(value = "Authorization", required = false) authHeader: String?,
        @RequestBody request: SetNicknameRequest
    ): ResponseEntity<Any> {
        val userId = supabaseAuth.getUserId(authHeader)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(mapOf("error" to "로그인이 필요해요."))
        return when (val result = userProfileService.setNickname(userId, request.nickname)) {
            is SetNicknameResult.Success -> ResponseEntity.ok(NicknameResponse(result.nickname))
            is SetNicknameResult.Duplicate -> ResponseEntity.status(HttpStatus.CONFLICT)
                .body(mapOf("error" to "이미 사용 중인 닉네임이에요."))
            is SetNicknameResult.Invalid -> ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(mapOf("error" to "닉네임은 2~20자로 입력해주세요."))
        }
    }

    // (2.5단계, 3단계에서 authHeader 추가) 공개 피드에서 닉네임을 누르면 들어오는 "그 사람
    // 페이지" — 그 닉네임이 공개한 재생목록 전체를 좋아요 많은 순으로 모아서 보여줌. 로그인/
    // 세션 여부와 무관하게 누구나 조회 가능(공개 피드와 같은 공개 범위) — Authorization은
    // listPublic과 같은 이유로 likedByMe 계산에만 선택적으로 씀.
    @GetMapping("/{nickname}")
    fun getProfile(
        @RequestHeader(value = "Authorization", required = false) authHeader: String?,
        @PathVariable nickname: String
    ): ResponseEntity<Any> {
        val profile = userProfileService.findByNickname(nickname)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()
        val playlists = playlistService.listPublicByUserId(profile.userId, viewerId = supabaseAuth.getUserId(authHeader))
        return ResponseEntity.ok(UserProfilePageResponse(nickname = profile.nickname, playlists = playlists))
    }
}
