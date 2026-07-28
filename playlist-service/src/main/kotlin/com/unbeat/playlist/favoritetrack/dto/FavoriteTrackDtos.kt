package com.unbeat.playlist.favoritetrack.dto

data class FavoriteTrackRequest(
    val artistName: String,
    val trackName: String
)

data class FavoriteTrackResponse(
    val id: Long,
    val artistName: String,
    val trackName: String,
    val tags: List<String>,
    val createdAt: String
)
