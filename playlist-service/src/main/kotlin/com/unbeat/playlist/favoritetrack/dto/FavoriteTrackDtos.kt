package com.unbeat.playlist.favoritetrack.dto

data class FavoriteTrackRequest(
    val artistName: String,
    val trackName: String,
    val trackUrl: String? = null
)

data class FavoriteTrackResponse(
    val id: Long,
    val artistName: String,
    val trackName: String,
    val tags: List<String>,
    val url: String?,
    val createdAt: String,
    val lastOpenedAt: String?
)
