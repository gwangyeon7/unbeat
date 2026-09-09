package com.unbeat.playlist.favoritetrack

import com.unbeat.playlist.favoritetrack.dto.FavoriteTrackRequest
import com.unbeat.playlist.lastfm.LastFmTagClient
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.mockito.Mockito.never
import org.mockito.kotlin.any
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever
import java.time.LocalDateTime
import java.util.Optional

class FavoriteTrackServiceTest {

    private val repository: FavoriteTrackRepository = mock()
    private val lastFmTagClient: LastFmTagClient = mock()
    private val service = FavoriteTrackService(repository, lastFmTagClient)

    @Test
    fun `새 트랙을 추가하면 Last_fm 태그를 가져와서 같이 저장한다`() {
        whenever(repository.findBySessionIdAndArtistNameAndTrackName("s1", "IU", "Blueming"))
            .thenReturn(null)
        whenever(lastFmTagClient.fetchTopTags("IU", "Blueming"))
            .thenReturn(listOf("kpop", "ballad"))

        val saved = FavoriteTrack(sessionId = "s1", artistName = "IU", trackName = "Blueming", tags = "kpop,ballad")
            .apply { id = 1L }
        whenever(repository.save(any())).thenReturn(saved)

        val result = service.add("s1", FavoriteTrackRequest(artistName = "IU", trackName = "Blueming"))

        assertEquals(listOf("kpop", "ballad"), result.tags)
    }

    @Test
    fun `곡 단위 태그가 비어있으면 아티스트 단위 태그로 폴백한다`() {
        whenever(repository.findBySessionIdAndArtistNameAndTrackName("s1", "IVE", "LOVE DIVE"))
            .thenReturn(null)
        whenever(lastFmTagClient.fetchTopTags("IVE", "LOVE DIVE"))
            .thenReturn(emptyList())
        whenever(lastFmTagClient.fetchArtistTags("IVE"))
            .thenReturn(listOf("dance"))

        val saved = FavoriteTrack(sessionId = "s1", artistName = "IVE", trackName = "LOVE DIVE", tags = "dance")
            .apply { id = 2L }
        whenever(repository.save(any())).thenReturn(saved)

        val result = service.add("s1", FavoriteTrackRequest(artistName = "IVE", trackName = "LOVE DIVE"))

        assertEquals(listOf("dance"), result.tags)
    }

    @Test
    fun `이미 즐겨찾기한 트랙은 태그를 다시 조회하지 않고 기존 걸 반환한다`() {
        val existing = FavoriteTrack(sessionId = "s1", artistName = "IU", trackName = "Blueming", tags = "kpop")
            .apply { id = 1L }
        whenever(repository.findBySessionIdAndArtistNameAndTrackName("s1", "IU", "Blueming"))
            .thenReturn(existing)

        val result = service.add("s1", FavoriteTrackRequest(artistName = "IU", trackName = "Blueming"))

        assertEquals(1L, result.id)
        verify(lastFmTagClient, never()).fetchTopTags(any(), any())
        verify(repository, never()).save(any())
    }

    @Test
    fun `다른 세션의 즐겨찾기 트랙은 삭제할 수 없다`() {
        val track = FavoriteTrack(sessionId = "owner", artistName = "IU", trackName = "Blueming")
            .apply { id = 1L }
        whenever(repository.findById(1L)).thenReturn(Optional.of(track))

        val removed = service.remove("stranger", 1L)

        assertFalse(removed)
        verify(repository, never()).delete(any<FavoriteTrack>())
    }

    @Test
    fun `즐겨찾기 곡을 클릭하면 lastOpenedAt이 갱신된다`() {
        val track = FavoriteTrack(sessionId = "s1", artistName = "IU", trackName = "Blueming")
            .apply { id = 1L }
        whenever(repository.findById(1L)).thenReturn(Optional.of(track))
        whenever(repository.save(any())).thenAnswer { it.arguments[0] }

        val result = service.markOpened("s1", 1L)

        assertNotNull(result)
        assertNotNull(result!!.lastOpenedAt)
    }

    @Test
    fun `다른 세션의 즐겨찾기 곡은 open으로 갱신할 수 없다`() {
        val track = FavoriteTrack(sessionId = "owner", artistName = "IU", trackName = "Blueming")
            .apply { id = 1L }
        whenever(repository.findById(1L)).thenReturn(Optional.of(track))

        val result = service.markOpened("stranger", 1L)

        assertNull(result)
        verify(repository, never()).save(any())
    }

    @Test
    fun `lastOpenedAt이 기준보다 오래됐으면 정리 후보에 포함된다`() {
        val stale = FavoriteTrack(
            sessionId = "s1", artistName = "IU", trackName = "Blueming",
            lastOpenedAt = LocalDateTime.now().minusMonths(7)
        ).apply { id = 1L }
        val recent = FavoriteTrack(
            sessionId = "s1", artistName = "IVE", trackName = "LOVE DIVE",
            lastOpenedAt = LocalDateTime.now().minusMonths(1)
        ).apply { id = 2L }
        whenever(repository.findBySessionIdOrderByCreatedAtDesc("s1")).thenReturn(listOf(stale, recent))

        val result = service.findStale("s1", months = 6)

        assertEquals(1, result.size)
        assertEquals(1L, result[0].id)
    }

    @Test
    fun `lastOpenedAt이 없으면 즐겨찾기한 시점(createdAt)을 기준으로 판단한다`() {
        val neverOpenedButOld = FavoriteTrack(
            sessionId = "s1", artistName = "잔나비", trackName = "주저하는 연인들을 위해",
            createdAt = LocalDateTime.now().minusMonths(8), lastOpenedAt = null
        ).apply { id = 3L }
        whenever(repository.findBySessionIdOrderByCreatedAtDesc("s1")).thenReturn(listOf(neverOpenedButOld))

        val result = service.findStale("s1", months = 6)

        assertEquals(1, result.size)
        assertEquals(3L, result[0].id)
    }
}
