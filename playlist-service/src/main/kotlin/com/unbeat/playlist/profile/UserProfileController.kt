package com.unbeat.playlist.profile

import com.unbeat.playlist.auth.SupabaseAuth
import com.unbeat.playlist.profile.dto.BadgeResponse
import com.unbeat.playlist.profile.dto.FollowListResponse
import com.unbeat.playlist.profile.dto.FollowResponse
import com.unbeat.playlist.profile.dto.FollowUserResponse
import com.unbeat.playlist.profile.dto.MyProfileResponse
import com.unbeat.playlist.profile.dto.NicknameResponse
import com.unbeat.playlist.profile.dto.SetBioRequest
import com.unbeat.playlist.profile.dto.SetNicknameRequest
import com.unbeat.playlist.profile.dto.UserProfilePageResponse
import com.unbeat.playlist.userplaylist.PlaylistService
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
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
        val viewerId = supabaseAuth.getUserId(authHeader)
        val playlists = playlistService.listPublicByUserId(profile.userId, viewerId = viewerId)

        // 프로필 화면에 자동으로 채워지는 값들 — 사용자가 따로 입력할 게 없도록 서버에서 계산
        val totalLikes = playlists.sumOf { it.likeCount }
        val followerCount = userProfileService.followerCount(profile.userId)
        val topCategories = playlists.mapNotNull { it.category }
            .groupingBy { it }.eachCount()
            .entries.sortedByDescending { it.value }
            .take(3).map { it.key }
        val badges = buildList {
            if (playlists.isNotEmpty()) add(BadgeResponse("first_public", "첫 공개"))
            if (playlists.size >= 3) add(BadgeResponse("playlists_3", "재생목록 3개"))
            if (totalLikes >= 10) add(BadgeResponse("likes_10", "좋아요 10개"))
            if (followerCount >= 5) add(BadgeResponse("followers_5", "팔로워 5명"))
        }

        return ResponseEntity.ok(
            UserProfilePageResponse(
                nickname = profile.nickname,
                playlists = playlists,
                bio = profile.bio,
                followerCount = followerCount,
                followingCount = userProfileService.followingCount(profile.userId),
                followedByMe = userProfileService.isFollowing(viewerId, profile.userId),
                isMe = viewerId != null && viewerId == profile.userId,
                totalLikes = totalLikes,
                topCategories = topCategories,
                badges = badges
            )
        )
    }

    // 팔로우/언팔로우 — 로그인 필수(401), 자기 자신은 400, 대상 닉네임이 없으면 404.
    @PostMapping("/{nickname}/follow")
    fun follow(
        @RequestHeader(value = "Authorization", required = false) authHeader: String?,
        @PathVariable nickname: String
    ): ResponseEntity<Any> {
        val userId = supabaseAuth.getUserId(authHeader)
            ?: return ResponseEntity.status(HttpStatus.FORBIDDEN).body(mapOf("error" to "로그인이 필요해요."))
        return followResponse(userProfileService.follow(userId, nickname))
    }

    @DeleteMapping("/{nickname}/follow")
    fun unfollow(
        @RequestHeader(value = "Authorization", required = false) authHeader: String?,
        @PathVariable nickname: String
    ): ResponseEntity<Any> {
        val userId = supabaseAuth.getUserId(authHeader)
            ?: return ResponseEntity.status(HttpStatus.FORBIDDEN).body(mapOf("error" to "로그인이 필요해요."))
        return followResponse(userProfileService.unfollow(userId, nickname))
    }

    private fun followResponse(result: FollowResult): ResponseEntity<Any> = when (result) {
        is FollowResult.Success -> ResponseEntity.ok(FollowResponse(result.followerCount, result.followedByMe))
        is FollowResult.NotFound -> ResponseEntity.status(HttpStatus.NOT_FOUND).build()
        is FollowResult.Self -> ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(mapOf("error" to "자기 자신은 팔로우할 수 없어요."))
    }

    // 팔로워/팔로잉 목록 — 누구나 조회 가능(공개 프로필과 같은 범위). followedByMe/isMe는 요청자
    // 기준이라, 목록에서 바로 팔로우 버튼을 보여줄 수 있음.
    @GetMapping("/{nickname}/followers")
    fun followers(
        @RequestHeader(value = "Authorization", required = false) authHeader: String?,
        @PathVariable nickname: String
    ): ResponseEntity<Any> = followList(authHeader, nickname) { userProfileService.followerProfiles(it) }

    @GetMapping("/{nickname}/following")
    fun following(
        @RequestHeader(value = "Authorization", required = false) authHeader: String?,
        @PathVariable nickname: String
    ): ResponseEntity<Any> = followList(authHeader, nickname) { userProfileService.followingProfiles(it) }

    private fun followList(
        authHeader: String?,
        nickname: String,
        load: (String) -> List<UserProfile>
    ): ResponseEntity<Any> {
        val target = userProfileService.findByNickname(nickname)
            ?: return ResponseEntity.status(HttpStatus.NOT_FOUND).build()
        val viewerId = supabaseAuth.getUserId(authHeader)
        val users = load(target.userId).map {
            FollowUserResponse(
                nickname = it.nickname,
                followedByMe = userProfileService.isFollowing(viewerId, it.userId),
                isMe = viewerId != null && viewerId == it.userId
            )
        }
        return ResponseEntity.ok(FollowListResponse(users))
    }

    // 한 줄 소개(선택). 닉네임이 아직 없으면 428.
    @PostMapping("/bio")
    fun setBio(
        @RequestHeader(value = "Authorization", required = false) authHeader: String?,
        @RequestBody request: SetBioRequest
    ): ResponseEntity<Any> {
        val userId = supabaseAuth.getUserId(authHeader)
            ?: return ResponseEntity.status(HttpStatus.FORBIDDEN).body(mapOf("error" to "로그인이 필요해요."))
        val bio = userProfileService.setBio(userId, request.bio)
            ?: return ResponseEntity.status(HttpStatus.PRECONDITION_REQUIRED).body(mapOf("error" to "닉네임을 먼저 정해주세요."))
        return ResponseEntity.ok(mapOf("bio" to bio))
    }
}
