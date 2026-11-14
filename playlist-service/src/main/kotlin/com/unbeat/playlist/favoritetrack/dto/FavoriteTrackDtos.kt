package com.unbeat.playlist.favoritetrack.dto

data class FavoriteTrackRequest(
    val artistName: String,
    val trackName: String,
    val trackUrl: String? = null,
    val imageUrl: String? = null
)

data class FavoriteTrackImageRequest(
    val imageUrl: String
)

data class FavoriteTrackResponse(
    val id: Long,
    val artistName: String,
    val trackName: String,
    val tags: List<String>,
    val url: String?,
    val imageUrl: String?,
    val createdAt: String,
    val lastOpenedAt: String?
)
