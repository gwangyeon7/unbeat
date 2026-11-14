package com.unbeat.playlist.profile

import org.springframework.stereotype.Service

// 닉네임 설정 결과 — 성공/중복/형식 오류를 컨트롤러가 각각 다른 상태 코드(200/409/400)로
// 내려줘야 해서 VisibilityResult와 같은 패턴의 sealed class로 분리.
sealed class SetNicknameResult {
    data class Success(val nickname: String) : SetNicknameResult()
    object Duplicate : SetNicknameResult()
    object Invalid : SetNicknameResult()
}

// 팔로우 결과 — 로그인 필요/대상 없음/자기 자신 팔로우 금지/성공
sealed class FollowResult {
    data class Success(val followerCount: Int, val followedByMe: Boolean) : FollowResult()
    object NotFound : FollowResult()
    object Self : FollowResult()
}

@Service
class UserProfileService(
    private val userProfileRepository: UserProfileRepository,
    private val followRepository: FollowRepository
) {
    fun followerCount(userId: String): Int = followRepository.countByFolloweeId(userId).toInt()
    fun followingCount(userId: String): Int = followRepository.countByFollowerId(userId).toInt()
    fun isFollowing(viewerId: String?, userId: String): Boolean =
        viewerId != null && followRepository.existsByFollowerIdAndFolloweeId(viewerId, userId)

    // 멱등 — 이미 팔로우 중이어도 중복 행이 안 쌓임
    fun follow(viewerId: String, nickname: String): FollowResult {
        val target = userProfileRepository.findByNickname(nickname) ?: return FollowResult.NotFound
        if (target.userId == viewerId) return FollowResult.Self
        if (!followRepository.existsByFollowerIdAndFolloweeId(viewerId, target.userId)) {
            followRepository.save(Follow(followerId = viewerId, followeeId = target.userId))
        }
        return FollowResult.Success(followerCount(target.userId), followedByMe = true)
    }

    @org.springframework.transaction.annotation.Transactional
    fun unfollow(viewerId: String, nickname: String): FollowResult {
        val target = userProfileRepository.findByNickname(nickname) ?: return FollowResult.NotFound
        followRepository.deleteByFollowerIdAndFolloweeId(viewerId, target.userId)
        return FollowResult.Success(followerCount(target.userId), followedByMe = false)
    }

    // 팔로워/팔로잉 목록 — 프로필 카드의 숫자를 눌렀을 때. 최근에 팔로우한 순.
    // (닉네임이 없는 사용자는 목록에 안 나옴 — 닉네임이 곧 공개 신원이라서)
    fun followerProfiles(userId: String): List<UserProfile> =
        followRepository.findByFolloweeId(userId).sortedByDescending { it.createdAt }
            .mapNotNull { userProfileRepository.findByUserId(it.followerId) }

    fun followingProfiles(userId: String): List<UserProfile> =
        followRepository.findByFollowerId(userId).sortedByDescending { it.createdAt }
            .mapNotNull { userProfileRepository.findByUserId(it.followeeId) }

    // 한 줄 소개 — 60자 제한, 빈 문자열이면 지움. 닉네임(프로필)이 아직 없으면 null.
    fun setBio(userId: String, rawBio: String): String? {
        val profile = userProfileRepository.findByUserId(userId) ?: return null
        val bio = rawBio.trim().take(60)
        profile.bio = bio.ifEmpty { null }
        userProfileRepository.save(profile)
        return profile.bio ?: ""
    }

    fun getNickname(userId: String): String? = userProfileRepository.findByUserId(userId)?.nickname

    fun findByNickname(nickname: String): UserProfile? = userProfileRepository.findByNickname(nickname)

    // 닉네임 변경도 같은 엔드포인트로 처리 — 이미 레코드가 있으면 그걸 수정하고, 없으면 새로
    // 만듦. 다른 사람이 이미 쓰는 닉네임이면 거부(자기 자신의 현재 닉네임으로 "변경"하는 건
    // 허용 — existing.userId == userId 체크로 자기 자신은 통과시킴).
    fun setNickname(userId: String, rawNickname: String): SetNicknameResult {
        val nickname = rawNickname.trim()
        if (nickname.length !in 2..20) return SetNicknameResult.Invalid

        val existing = userProfileRepository.findByNickname(nickname)
        if (existing != null && existing.userId != userId) return SetNicknameResult.Duplicate

        val myProfile = userProfileRepository.findByUserId(userId)
        if (myProfile != null) {
            myProfile.nickname = nickname
            userProfileRepository.save(myProfile)
        } else {
            userProfileRepository.save(UserProfile(userId = userId, nickname = nickname))
        }
        return SetNicknameResult.Success(nickname)
    }
}
