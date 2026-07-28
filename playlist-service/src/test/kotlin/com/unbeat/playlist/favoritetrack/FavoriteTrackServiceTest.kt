package com.unbeat.playlist.favoritetrack

import com.unbeat.playlist.favoritetrack.dto.FavoriteTrackRequest
import com.unbeat.playlist.lastfm.LastFmTagClient
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import org.mockito.Mockito.never
import org.mockito.kotlin.any
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever
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
}
