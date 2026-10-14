package com.unbeat.playlist.profile

import org.springframework.data.jpa.repository.JpaRepository

interface UserProfileRepository : JpaRepository<UserProfile, Long> {
    fun findByUserId(userId: String): UserProfile?
    fun findByNickname(nickname: String): UserProfile?
}
