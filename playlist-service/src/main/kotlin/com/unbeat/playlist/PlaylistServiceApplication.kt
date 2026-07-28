package com.unbeat.playlist

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

@SpringBootApplication
class PlaylistServiceApplication

fun main(args: Array<String>) {
	runApplication<PlaylistServiceApplication>(*args)
}
