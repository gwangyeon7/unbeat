package com.unbeat.playlist.userplaylist

import com.unbeat.playlist.userplaylist.dto.PlaylistRequest
import com.unbeat.playlist.userplaylist.dto.PlaylistTrackRequest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.kotlin.any
import org.mockito.kotlin.mock
import org.mockito.kotlin.never
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever
import java.util.Optional

class PlaylistServiceTest {

    private val playlistRepository: PlaylistRepository = mock()
    private val playlistTrackRepository: PlaylistTrackRepository = mock()
    private val service = PlaylistService(playlistRepository, playlistTrackRepository)

    @Test
    fun `이름을 비워서 만들면 기본 이름이 붙는다`() {
        val saved = Playlist(sessionId = "s1", name = "새 재생목록").apply { id = 1L }
        whenever(playlistRepository.save(any())).thenReturn(saved)
        whenever(playlistTrackRepository.countByPlaylistId(1L)).thenReturn(0L)

        val result = service.create("s1", PlaylistRequest(name = "   "))

        assertEquals("새 재생목록", result.name)
        assertEquals(0, result.trackCount)
    }

    @Test
    fun `다른 세션의 재생목록은 삭제할 수 없다`() {
        val playlist = Playlist(sessionId = "owner", name = "출퇴근길").apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))

        val removed = service.delete("stranger", 1L)

        assertFalse(removed)
        verify(playlistTrackRepository, never()).deleteByPlaylistId(any())
        verify(playlistRepository, never()).delete(any<Playlist>())
    }

    @Test
    fun `재생목록을 지우면 담긴 곡도 같이 지운다`() {
        val playlist = Playlist(sessionId = "s1", name = "출퇴근길").apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))

        val removed = service.delete("s1", 1L)

        assertTrue(removed)
        verify(playlistTrackRepository).deleteByPlaylistId(1L)
        verify(playlistRepository).delete(playlist)
    }

    @Test
    fun `같은 곡을 같은 재생목록에 두 번 추가하면 기존 걸 그대로 반환한다`() {
        val playlist = Playlist(sessionId = "s1", name = "출퇴근길").apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))
        val existing = PlaylistTrack(playlistId = 1L, artistName = "IU", trackName = "Blueming").apply { id = 5L }
        whenever(playlistTrackRepository.findByPlaylistIdAndArtistNameAndTrackName(1L, "IU", "Blueming"))
            .thenReturn(existing)

        val result = service.addTrack("s1", 1L, PlaylistTrackRequest(artistName = "IU", trackName = "Blueming"))

        assertEquals(5L, result?.id)
        verify(playlistTrackRepository, never()).save(any())
    }

    @Test
    fun `존재하지 않는 재생목록에는 곡을 추가할 수 없다`() {
        whenever(playlistRepository.findById(99L)).thenReturn(Optional.empty())

        val result = service.addTrack("s1", 99L, PlaylistTrackRequest(artistName = "IU", trackName = "Blueming"))

        assertNull(result)
    }

    @Test
    fun `다른 재생목록 소속 곡은 지울 수 없다`() {
        val playlist = Playlist(sessionId = "s1", name = "출퇴근길").apply { id = 1L }
        whenever(playlistRepository.findById(1L)).thenReturn(Optional.of(playlist))
        val trackInOtherPlaylist = PlaylistTrack(playlistId = 2L, artistName = "IU", trackName = "Blueming")
            .apply { id = 5L }
        whenever(playlistTrackRepository.findById(5L)).thenReturn(Optional.of(trackInOtherPlaylist))

        val removed = service.removeTrack("s1", 1L, 5L)

        assertFalse(removed)
        verify(playlistTrackRepository, never()).delete(any<PlaylistTrack>())
    }
}
