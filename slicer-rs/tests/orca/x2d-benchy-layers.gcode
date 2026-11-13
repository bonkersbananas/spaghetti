; CHANGE_LAYER
; Z_HEIGHT: 0.2
; LAYER_HEIGHT: 0.2
G1 E-.4 F1800
;======== X2D layer_change gcode ==========
;===== 2026/07/01 =====







    M106 P2 S102
	M106 P10 S102

;not reset fan



; update layer progress
M73 L1
M991 S0 P0 ;notify layer change

;_SET_FAN_SPEED_CHANGING_LAYER
; CHANGE_LAYER
; Z_HEIGHT: 0.4
; LAYER_HEIGHT: 0.2
;======== X2D layer_change gcode ==========
;===== 2026/07/01 =====





    M106 P2 S102
	M106 P10 S102

;not reset fan



; update layer progress
M73 L2
M991 S0 P1 ;notify layer change

;_SET_FAN_SPEED_CHANGING_LAYER
; CHANGE_LAYER
; Z_HEIGHT: 0.6
; LAYER_HEIGHT: 0.2
;======== X2D layer_change gcode ==========
;===== 2026/07/01 =====





    M106 P2 S102
	M106 P10 S102

;not reset fan



; update layer progress
M73 L3
M991 S0 P2 ;notify layer change

;_SET_FAN_SPEED_CHANGING_LAYER
; CHANGE_LAYER
; Z_HEIGHT: 0.8
; LAYER_HEIGHT: 0.2
;======== X2D layer_change gcode ==========
;===== 2026/07/01 =====





    ;updata chamber autocooling in Xth layer
    
        
            M142 P1 R30 S40 U0.7 V1.0 O45; set PLA/TPU ND0.4 chamber autocooling
        
    

;not reset fan



; update layer progress
M73 L4
M991 S0 P3 ;notify layer change

;_SET_FAN_SPEED_CHANGING_LAYER
; CHANGE_LAYER
; Z_HEIGHT: 1
; LAYER_HEIGHT: 0.2
;======== X2D layer_change gcode ==========
;===== 2026/07/01 =====






; update layer progress
M73 L5
M991 S0 P4 ;notify layer change

;_SET_FAN_SPEED_CHANGING_LAYER
