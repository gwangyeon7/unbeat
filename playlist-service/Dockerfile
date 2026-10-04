# unbeat 플레이리스트/즐겨찾기 서비스(Kotlin + Spring Boot) 배포용 이미지.
# 멀티스테이지: 1단계에서 빌드만 하고, 실행 이미지엔 JAR만 남겨서 최종 이미지 크기를 줄임.
#
# gradle-wrapper.properties가 Gradle 9.0.0을 지정하고 있어서, 베이스 이미지에 깔린
# gradle 버전에 기대지 않고 항상 프로젝트에 체크인된 ./gradlew로 빌드함
# (build.gradle.kts 주석에도 있듯 Gradle 버전이 안 맞으면 플러그인 호환성 문제가 생김).
FROM eclipse-temurin:17-jdk AS build
WORKDIR /app
COPY gradlew ./
COPY gradle ./gradle
COPY build.gradle.kts settings.gradle.kts ./
COPY src ./src
RUN chmod +x gradlew && ./gradlew bootJar --no-daemon

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/build/libs/*.jar app.jar

# Render는 컨테이너가 리슨할 포트를 PORT 환경변수로 줌 — application.yml의
# server.port가 ${PORT:8081}로 이미 이걸 읽도록 되어 있어서 별도 인자 없이 그대로 실행.
#
# 임시 디버깅: Spring Boot가 뜨기 직전에 DB_HOST:DB_PORT로 순수 TCP 연결을 먼저 테스트해서
# 로그에 성공/실패를 명확히 찍음. MariaDB 쪽 로그(헬스체크 트래픽과 뒤섞여 애매함)에 기대지
#않고 playlist 컨테이너 자신의 로그에서 바로 원인(네트워크 불통 vs 인증/설정 문제)을 구분하기
# 위함 — 원인 확인되면 이 블록은 제거하고 CMD를 다시 ["java", "-jar", "app.jar"]로 되돌릴 것.
CMD ["bash", "-c", "echo \"[DB CHECK] host=${DB_HOST} port=${DB_PORT}\"; timeout 5 bash -c \"cat < /dev/null > /dev/tcp/${DB_HOST}/${DB_PORT}\" && echo '[DB CHECK] TCP OK - reached DB host/port' || echo '[DB CHECK] TCP FAILED - could not reach DB host/port'; exec java -jar app.jar"]
