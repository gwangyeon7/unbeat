package com.unbeat.playlist.favoritetrack

import com.unbeat.playlist.favoritetrack.dto.FavoriteTrackRequest
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/favorite-tracks")
class FavoriteTrackController(private val favoriteTrackService: FavoriteTrackService) {

    @GetMapping
    fun list(@RequestHeader("X-Session-Id") sessionId: String) =
        favoriteTrackService.list(sessionId)

    @PostMapping
    fun add(
        @RequestHeader("X-Session-Id") sessionId: String,
        @RequestBody request: FavoriteTrackRequest
    ): ResponseEntity<Any> {
        val response = favoriteTrackService.add(sessionId, request)
        return ResponseEntity.status(HttpStatus.CREATED).body(response)
    }

    @DeleteMapping("/{id}")
    fun remove(
        @RequestHeader("X-Session-Id") sessionId: String,
        @PathVariable id: Long
    ): ResponseEntity<Any> {
        val removed = favoriteTrackService.remove(sessionId, id)
        return if (removed) ResponseEntity.noContent().build()
        else ResponseEntity.status(HttpStatus.NOT_FOUND).build()
    }
}
