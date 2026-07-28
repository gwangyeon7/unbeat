package com.unbeat.playlist.favorite.dto

data class FavoriteRequest(
	val artistName: String,
	val imageUrl: String? = null
)

data class FavoriteResponse(
	val id: Long,
	val artistName: String,
	val imageUrl: String?,
	val createdAt: String
)
