package com.unbeat.playlist.favoritetrack

import com.unbeat.playlist.favoritetrack.dto.FavoriteTrackRequest
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/favorite-tracks")
class FavoriteTrackController(private val favoriteTrackService: FavoriteTrackService) {

    @GetMapping
    fun list(@RequestHeader("X-Session-Id") sessionId: String) =
        favoriteTrackService.list(sessionId)

    // "즐겨찾기했는데 오래 안 들은 곡"을 찾아서 사용자에게 지워도 될지 물어보는 정리 기능용.
    // 기본 6개월 — "몇 달이 적당한가"는 정답이 없는 판단이라, 무작정 정한 값이 아니라
    // 나중에 조정할 여지를 남기려고 쿼리 파라미터로 뺌(프론트는 지금은 6으로만 호출).
    @GetMapping("/stale")
    fun stale(
        @RequestHeader("X-Session-Id") sessionId: String,
        @RequestParam(defaultValue = "6") months: Long
    ) = favoriteTrackService.findStale(sessionId, months)

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

    /**
     * 즐겨찾기한 곡 카드를 눌러 원곡 링크로 나갈 때 프론트에서 호출.
     * "재생" 자체는 관측 불가능하니 이 클릭을 재생 의도 신호로 기록해서,
     * 나중에 "안 듣는 곡" 자동 분류 배치의 입력으로 쓴다.
     */
    @PatchMapping("/{id}/open")
    fun markOpened(
        @RequestHeader("X-Session-Id") sessionId: String,
        @PathVariable id: Long
    ): ResponseEntity<Any> {
        val response = favoriteTrackService.markOpened(sessionId, id)
        return if (response != null) ResponseEntity.ok(response)
        else ResponseEntity.status(HttpStatus.NOT_FOUND).build()
    }
}
