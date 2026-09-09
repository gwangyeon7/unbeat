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

            cleanTags(response?.toptags?.tag.orEmpty(), artistName)
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

            cleanTags(response?.toptags?.tag.orEmpty(), artistName)
        } catch (ex: Exception) {
            logger.warn("Last.fm 아티스트 태그 조회 실패 (artist={}): {}", artistName, ex.message)
            emptyList()
        }
    }

    /**
     * Last.fm 태그는 크라우드소싱이라 장르/무드와 무관한 잡음이 자주 섞여 있음 — 실제로 "아이유" 곡에서
     * "iu"(아티스트 자기 자신 이름), "korean"(국적/언어일 뿐 장르/무드 정보가 없음) 같은 태그가 나와서
     * "즐겨찾기 태그 요약"/"다시 듣기" 그룹이 지저분해진다는 피드백을 받고 추가한 필터링.
     * - 아티스트 자신의 이름과 같은 태그는 그룹핑 의미가 없음(이미 "즐겨찾기 아티스트" 목록에 따로 있음).
     *   저장은 한글 아티스트명("아이유")으로 되는데 Last.fm 태그는 영문 활동명("iu")으로 붙는 경우가 많아서
     *   단순 문자열 비교로는 못 걸러내 — 오타 교정 때 만든 한글 아티스트 후보 목록(backend KNOWN_KOREAN_ARTIST_NAMES)과
     *   같은 맥락으로, 자주 나오는 것들만 우선 매핑해둔 좁은 목록(ARTIST_SELF_TAG_ALIASES). 완전하진 않지만
     *   "커버리지보다 정확도"를 택한 그 결정과 동일한 트레이드오프.
     * - 국적/언어, "seen live"/"favorite" 같은 청취 메타 태그는 장르/무드 그룹핑 기준으로 부적절해서 제외
     */
    private fun cleanTags(rawTags: List<LastFmTag>, artistName: String): List<String> {
        val normalizedArtist = normalize(artistName)
        val selfAliases = ARTIST_SELF_TAG_ALIASES[normalizedArtist].orEmpty()
        return rawTags
            .sortedByDescending { it.count }
            .map { it.name.trim().lowercase() }
            .filter { it.isNotBlank() }
            .filterNot { normalize(it) == normalizedArtist }
            .filterNot { it in selfAliases }
            .filterNot { it in NOISE_TAGS }
            .distinct()
            .take(3)
    }

    private fun normalize(value: String) = value.trim().lowercase().replace(Regex("[^a-z0-9가-힣]"), "")

    companion object {
        private val NOISE_TAGS = setOf(
            "korean", "japanese", "chinese", "american", "british", "asian",
            "seen live", "favorite", "favorites", "favourite", "favourites",
            "beautiful", "awesome", "love", "loved", "cool",
            "female vocalists", "male vocalists", "vocalists"
        )

        // key는 normalize()된 한글 아티스트명. 자주 즐겨찾기될 만한 것 위주로만 우선 등록 (좁은 커버리지, 점진적 확장 대상)
        private val ARTIST_SELF_TAG_ALIASES: Map<String, Set<String>> = mapOf(
            normalizeStatic("아이유") to setOf("iu"),
            normalizeStatic("방탄소년단") to setOf("bts"),
            normalizeStatic("있지") to setOf("itzy"),
            normalizeStatic("트와이스") to setOf("twice"),
            normalizeStatic("에스파") to setOf("aespa"),
            normalizeStatic("뉴진스") to setOf("newjeans"),
            normalizeStatic("르세라핌") to setOf("lesserafim", "le sserafim"),
            normalizeStatic("엔하이픈") to setOf("enhypen"),
            normalizeStatic("여자아이들") to setOf("gidle", "(g)idle", "(g)i-dle"),
            normalizeStatic("스트레이 키즈") to setOf("straykids", "stray kids")
        )

        private fun normalizeStatic(value: String) = value.trim().lowercase().replace(Regex("[^a-z0-9가-힣]"), "")
    }
}

data class LastFmTopTagsResponse(val toptags: TopTags?)
data class TopTags(val tag: List<LastFmTag> = emptyList())
data class LastFmTag(val name: String, val count: Int = 0)
