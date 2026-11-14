package com.unbeat.playlist.profile

import org.springframework.data.jpa.repository.JpaRepository

interface FollowRepository : JpaRepository<Follow, Long> {
    fun existsByFollowerIdAndFolloweeId(followerId: String, followeeId: String): Boolean
    fun countByFolloweeId(followeeId: String): Long
    fun countByFollowerId(followerId: String): Long
    fun findByFollowerId(followerId: String): List<Follow>
    fun findByFolloweeId(followeeId: String): List<Follow>
    fun deleteByFollowerIdAndFolloweeId(followerId: String, followeeId: String)
}
