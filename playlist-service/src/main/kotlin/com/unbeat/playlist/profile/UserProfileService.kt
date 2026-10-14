package com.unbeat.playlist.profile

import org.springframework.stereotype.Service

// 닉네임 설정 결과 — 성공/중복/형식 오류를 컨트롤러가 각각 다른 상태 코드(200/409/400)로
// 내려줘야 해서 VisibilityResult와 같은 패턴의 sealed class로 분리.
sealed class SetNicknameResult {
    data class Success(val nickname: String) : SetNicknameResult()
    object Duplicate : SetNicknameResult()
    object Invalid : SetNicknameResult()
}

@Service
class UserProfileService(
    private val userProfileRepository: UserProfileRepository
) {
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
