package com.unbeat.playlist.lastfm

import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import org.springframework.web.client.RestClient

/**
 * Last.fm의 track.getTopTags를 호출해서 곡의 크라우드소싱 태그(예: kpop, ballad, summer)를 가져온다.
 * 이 태그가 나중에 "무드/장르별 자동 그룹핑"의 기준 데이터가 된다.
 *
 * FastAPI 백엔드도 이미 Last.fm을 호출하고 있지만, 서비스 소유권을 지키기 위해
 * (즐겨찾기 도메인은 playlist-service가 책임진다) 여기서 별도로 직접 호출한다.
 */
@Component
class LastFmTagClient(
    @Value("\${lastfm.api-key}") private val apiKey: String
) {
    private val logger = LoggerFactory.getLogger(LastFmTagClient::class.java)
    private val restClient = RestClient.create("https://ws.audioscrobbler.com/2.0/")

    fun fetchTopTags(artistName: String, trackName: String): List<String> {
        if (apiKey.isBlank()) {
            logger.warn("LASTFM_API_KEY가 설정 안 돼있어서 태그 조회를 건너뜀")
            return emptyList()
        }

        return try {
            val response = restClient.get()
                .uri { uriBuilder ->
                    uriBuilder
                        .queryParam("method", "track.getTopTags")
                        .queryParam("artist", artistName)
                        .queryParam("track", trackName)
                        .queryParam("api_key", apiKey)
                        .queryParam("format", "json")
                        .build()
                }
                .retrieve()
                .body(LastFmTopTagsResponse::class.java)

            response?.toptags?.tag.orEmpty()
                .sortedByDescending { it.count }
                .take(3)
                .map { it.name.lowercase() }
        } catch (ex: Exception) {
            // 태그 조회는 부가 기능 — 실패해도 즐겨찾기 저장 자체는 막지 않는다 (장애 격리, Redis/이벤트로깅과 같은 원칙)
            logger.warn("Last.fm 태그 조회 실패 (artist={}, track={}): {}", artistName, trackName, ex.message)
            emptyList()
        }
    }

    /**
     * 곡 단위 태그(fetchTopTags)가 비어있을 때 쓰는 폴백.
     * Last.fm은 태그가 "곡"보다 "아티스트"에 훨씬 많이 붙는 편이라(예: kpop, girl group 같은 큰 장르 태그는
     * 아티스트 페이지에 누적됨), 케이팝처럼 트랙 단위 태그가 빈약한 경우 이걸로 최소한 장르 정도는 잡아낸다.
     */
    fun fetchArtistTags(artistName: String): List<String> {
        if (apiKey.isBlank()) return emptyList()

        return try {
            val response = restClient.get()
                .uri { uriBuilder ->
                    uriBuilder
                        .queryParam("method", "artist.getTopTags")
                        .queryParam("artist", artistName)
                        .queryParam("api_key", apiKey)
                        .queryParam("format", "json")
                        .build()
                }
                .retrieve()
                .body(LastFmTopTagsResponse::class.java)

            response?.toptags?.tag.orEmpty()
                .sortedByDescending { it.count }
                .take(3)
                .map { it.name.lowercase() }
        } catch (ex: Exception) {
            logger.warn("Last.fm 아티스트 태그 조회 실패 (artist={}): {}", artistName, ex.message)
            emptyList()
        }
    }
}

data class LastFmTopTagsResponse(val toptags: TopTags?)
data class TopTags(val tag: List<LastFmTag> = emptyList())
data class LastFmTag(val name: String, val count: Int = 0)
