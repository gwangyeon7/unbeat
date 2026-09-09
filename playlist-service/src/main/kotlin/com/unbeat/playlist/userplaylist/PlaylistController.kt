package com.unbeat.playlist.userplaylist

import com.unbeat.playlist.userplaylist.dto.PlaylistRequest
import com.unbeat.playlist.userplaylist.dto.PlaylistTrackRequest
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
@RequestMapping("/playlists")
class PlaylistController(
    private val playlistService: PlaylistService,
    private val autoPlaylistService: AutoPlaylistService
) {

    @GetMapping
    fun list(@RequestHeader("X-Session-Id") sessionId: String) = playlistService.list(sessionId)

    // 즐겨찾기한 곡을 장르별로 분석해서 재생목록을 자동 생성 — "직접 이름 짓고 곡을 일일이 넣는 게
    // 뻔하다"는 피드백으로 추가. 매번 눌러도 중복이 안 쌓이게 이전 자동 생성 결과는 지우고 다시 만듦.
    @PostMapping("/auto-generate")
    fun generateAuto(@RequestHeader("X-Session-Id") sessionId: String) =
        autoPlaylistService.generate(sessionId)

    @PostMapping
    fun create(
        @RequestHeader("X-Session-Id") sessionId: String,
        @RequestBody request: PlaylistRequest
    ): ResponseEntity<Any> {
        val response = playlistService.create(sessionId, request)
        return ResponseEntity.status(HttpStatus.CREATED).body(response)
    }

    @DeleteMapping("/{id}")
    fun delete(
        @RequestHeader("X-Session-Id") sessionId: String,
        @PathVariable id: Long
    ): ResponseEntity<Any> {
        val removed = playlistService.delete(sessionId, id)
        return if (removed) ResponseEntity.noContent().build()
        else ResponseEntity.status(HttpStatus.NOT_FOUND).build()
    }

    @GetMapping("/{id}/tracks")
    fun getTracks(
        @RequestHeader("X-Session-Id") sessionId: String,
        @PathVariable id: Long
    ): ResponseEntity<Any> {
        val tracks = playlistService.getTracks(sessionId, id)
        return if (tracks != null) ResponseEntity.ok(tracks)
        else ResponseEntity.status(HttpStatus.NOT_FOUND).build()
    }

    @PostMapping("/{id}/tracks")
    fun addTrack(
        @RequestHeader("X-Session-Id") sessionId: String,
        @PathVariable id: Long,
        @RequestBody request: PlaylistTrackRequest
    ): ResponseEntity<Any> {
        val response = playlistService.addTrack(sessionId, id, request)
        return if (response != null) ResponseEntity.status(HttpStatus.CREATED).body(response)
        else ResponseEntity.status(HttpStatus.NOT_FOUND).build()
    }

    @DeleteMapping("/{id}/tracks/{trackId}")
    fun removeTrack(
        @RequestHeader("X-Session-Id") sessionId: String,
        @PathVariable id: Long,
        @PathVariable trackId: Long
    ): ResponseEntity<Any> {
        val removed = playlistService.removeTrack(sessionId, id, trackId)
        return if (removed) ResponseEntity.noContent().build()
        else ResponseEntity.status(HttpStatus.NOT_FOUND).build()
    }
}
