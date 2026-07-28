package com.unbeat.playlist.favorite

import org.springframework.data.jpa.repository.JpaRepository

interface FavoriteRepository : JpaRepository<Favorite, Long> {
	fun findBySessionIdOrderByCreatedAtDesc(sessionId: String): List<Favorite>
	fun findBySessionIdAndArtistName(sessionId: String, artistName: String): Favorite?
}
