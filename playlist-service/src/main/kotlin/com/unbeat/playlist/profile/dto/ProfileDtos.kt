package com.unbeat.playlist.profile.dto

import com.fasterxml.jackson.annotation.JsonProperty
import com.unbeat.playlist.userplaylist.dto.PublicPlaylistResponse

// PlaylistVisibilityRequest와 같은 이유(Kotlin 단일 프로퍼티 데이터 클래스의 Jackson
// creator-detection 버그, [[학습노트 89번]])로 혹시 몰라 @get/@param을 명시적으로 고정해둠 —
// 이쪽은 프로퍼티명이 "is"로 시작하지 않아 실제로는 문제가 재현되지 않지만, 같은 패턴의
// 단일 파라미터 요청 DTO라 방어적으로 통일함.
data class SetNicknameRequest(
    @get:JsonProperty("nickname")
    @param:JsonProperty("nickname")
    val nickname: String
)

data class MyProfileResponse(
    val nickname: String?
)

data class NicknameResponse(
    val nickname: String
)

data class BadgeResponse(
    val key: String,
    val label: String
)

// 프로필 화면용 — 자동 계산되는 값(좋아요 합계/배지/장르)과 선택 입력값(bio)을 한 번에 내려줌.
// isMe/followedByMe는 요청자가 로그인했을 때만 의미 있음(비로그인이면 둘 다 false).
data class UserProfilePageResponse(
    val nickname: String,
    val playlists: List<PublicPlaylistResponse>,
    val bio: String?,
    val followerCount: Int,
    val followingCount: Int,
    val followedByMe: Boolean,
    @get:JsonProperty("isMe")
    val isMe: Boolean,
    val totalLikes: Int,
    val topCategories: List<String>,
    val badges: List<BadgeResponse>
)

data class FollowResponse(
    val followerCount: Int,
    val followedByMe: Boolean
)

data class FollowUserResponse(
    val nickname: String,
    val followedByMe: Boolean,
    @get:JsonProperty("isMe")
    val isMe: Boolean
)

data class FollowListResponse(
    val users: List<FollowUserResponse>
)

data class SetBioRequest(
    @get:JsonProperty("bio")
    @param:JsonProperty("bio")
    val bio: String
)
