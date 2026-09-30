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
CMD ["java", "-jar", "app.jar"]
